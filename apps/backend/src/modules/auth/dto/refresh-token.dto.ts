import { IsOptional, IsString } from 'class-validator';

// Part 4: API Specification - Refresh Token DTO
// PD-A1: browsers present the refresh token via HttpOnly cookie; the body
// field remains for direct API clients (smoke script, curl).

export class RefreshTokenDto {
  @IsOptional()
  @IsString()
  refresh_token?: string;
}
