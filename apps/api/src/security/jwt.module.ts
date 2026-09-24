import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

/**
 * JwtService is needed by AuthService (signing) and by JwtAccessGuard, which
 * Nest instantiates in the context of whichever module declares a guarded
 * controller. Registering the module once, globally, keeps the guard
 * resolvable everywhere instead of requiring every feature module to
 * re-import JwtModule.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET') || 'dev-secret',
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  // Exporting the module re-exports its JwtService provider; a module may only
  // export things that are part of itself.
  exports: [JwtModule],
})
export class AuthJwtModule {}
