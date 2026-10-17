import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from './entities/user.entity';
import { RefreshSession } from './entities/refresh-session.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

// Part 4: API Specification - Auth service
// Part 7: Security & GDPR - Password hashing with bcrypt
//
// PD-A2 (public-demo audit): refresh tokens are server-side sessions now —
// every refresh token issued has a row holding only its SHA-256 hash. Each
// refresh ROTATES the token (old session revoked, new one issued); reusing a
// revoked token is treated as theft and revokes the user's entire chain.

// PD-A4: identical body for fresh and duplicate registrations.
export const REGISTER_SUCCESS_MESSAGE = 'Registration successful. You can now log in.';

export function parseDurationMs(raw: string): number {
  const m = raw.match(/^(\d+)([smhd])$/);
  if (!m) return 30 * 24 * 3_600_000; // 30d default
  const n = parseInt(m[1], 10);
  const unitMs: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 24 * 3_600_000,
  };
  return n * unitMs[m[2]];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(RefreshSession)
    private refreshSessionsRepository: Repository<RefreshSession>,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    // P0-3 (audit): normalize email so john@x.com and JOHN@x.com are one account
    const email = dto.email.toLowerCase().trim();
    // Check if user exists
    const existingUser = await this.usersRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      // PD-A4 (public-demo audit): no "User already exists" oracle. The
      // response is byte-identical to a fresh registration (same 201, same
      // body, no Set-Cookie difference), and a bcrypt round burns the same
      // CPU as the real path so timing doesn't answer either. Login is the
      // single gate — it already answers a uniform "Invalid credentials".
      await bcrypt.hash(dto.password, 10);
      return { message: REGISTER_SUCCESS_MESSAGE };
    }

    // Hash password
    const password_hash = await bcrypt.hash(dto.password, 10);

    // Create user
    const user = this.usersRepository.create({
      email,
      name: dto.name,
      password_hash,
    });
    await this.usersRepository.save(user);

    return { message: REGISTER_SUCCESS_MESSAGE };
  }

  async login(dto: LoginDto) {
    // P0-3 (audit): match the register-side normalization
    const email = dto.email.toLowerCase().trim();
    // Find user
    const user = await this.usersRepository.findOne({
      where: { email },
    });
    if (!user || !user.password_hash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isValid = await bcrypt.compare(dto.password, user.password_hash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Update last login
    user.last_login = new Date();
    await this.usersRepository.save(user);

    // Hygiene: expired sessions have no forensic value — drop them lazily.
    await this.refreshSessionsRepository.delete({ expires_at: LessThan(new Date()) });

    // Generate tokens
    const tokens = await this.generateTokens(user.id);
    // PD-A1: tokens travel as cookies (set by the controller); the body
    // identifies the user only.
    return { user_id: user.id, ...tokens };
  }

  async refreshTokens(dto: RefreshTokenDto) {
    if (!dto.refresh_token) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    let payload: { sub: string; type?: string };
    try {
      payload = this.jwtService.verify<{ sub: string; type?: string }>(dto.refresh_token, {
        secret: process.env.JWT_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // P0-3 (audit): refresh endpoint must accept refresh tokens only
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const hash = hashToken(dto.refresh_token);
    const session = await this.refreshSessionsRepository.findOne({
      where: { token_hash: hash },
    });

    // Signed correctly but no live session row: purged or never issued.
    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // PD-A2: reuse of an already-rotated/revoked refresh token is theft —
    // burn the user's whole session chain so the stolen token and the
    // legitimate one both die.
    if (session.revoked_at) {
      this.logger.warn(`Refresh token reuse detected for user ${session.user_id} — revoking all sessions`);
      await this.revokeAllForUser(session.user_id);
      throw new UnauthorizedException('Refresh token reuse detected — all sessions revoked');
    }

    if (session.expires_at.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Rotate: this exact token can never be used again.
    session.revoked_at = new Date();
    session.last_used_at = session.revoked_at;
    await this.refreshSessionsRepository.save(session);

    // Belt and braces: the user must still exist.
    const user = await this.usersRepository.findOne({
      where: { id: session.user_id },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.generateTokens(user.id);
  }

  /** PD-A2: server-side logout — the refresh token dies here, not just in the browser. */
  async logout(refreshToken?: string): Promise<{ message: string }> {
    if (refreshToken) {
      await this.refreshSessionsRepository.update(
        { token_hash: hashToken(refreshToken) },
        { revoked_at: new Date() },
      );
    }
    // Idempotent: an unknown/expired token still counts as logged out.
    return { message: 'Logged out' };
  }

  /** PD-A2: kill every live session of a user (theft response / account deletion). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshSessionsRepository.update(
      { user_id: userId, revoked_at: IsNull() },
      { revoked_at: new Date() },
    );
  }

  private async generateTokens(userId: string) {
    // P0-3 (audit): access and refresh are no longer interchangeable —
    // JwtStrategy rejects tokens without type 'access'
    const access_token = this.jwtService.sign(
      { sub: userId, type: 'access' },
      {
        expiresIn: process.env.JWT_ACCESS_EXPIRATION || '15m',
      },
    );
    const refresh_token = this.jwtService.sign(
      { sub: userId, type: 'refresh' },
      {
        expiresIn: process.env.JWT_REFRESH_EXPIRATION || '30d',
      },
    );

    // PD-A2: persist the session (hash only). Rotation invalidates the old
    // row; logout and reuse detection flip revoked_at.
    const refreshTtlMs = parseDurationMs(process.env.JWT_REFRESH_EXPIRATION || '30d');
    const session = this.refreshSessionsRepository.create({
      user_id: userId,
      token_hash: hashToken(refresh_token),
      expires_at: new Date(Date.now() + refreshTtlMs),
    });
    await this.refreshSessionsRepository.save(session);

    return { access_token, refresh_token };
  }

  async findById(id: string) {
    return this.usersRepository.findOne({ where: { id } });
  }
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
