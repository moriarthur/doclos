import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

// Part 4: API Specification - Auth service
// Part 7: Security & GDPR - Password hashing with bcrypt

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
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
      throw new ConflictException('User already exists');
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

    // Generate tokens
    const tokens = await this.generateTokens(user.id);
    return {
      user_id: user.id,
      ...tokens,
    };
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

    // Generate tokens
    const tokens = await this.generateTokens(user.id);
    return tokens;
  }

  async refreshTokens(dto: RefreshTokenDto) {
    try {
      const payload = this.jwtService.verify<{ sub: string; type?: string }>(dto.refresh_token, {
        secret: process.env.JWT_SECRET,
      });

      // P0-3 (audit): refresh endpoint must accept refresh tokens only
      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const user = await this.usersRepository.findOne({
        where: { id: payload.sub },
      });
      if (!user) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      return this.generateTokens(user.id);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
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
    return { access_token, refresh_token };
  }

  async findById(id: string) {
    return this.usersRepository.findOne({ where: { id } });
  }
}
