import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  if (process.env.NODE_ENV === 'production' || !process.env.DEMO_TOKEN) {
    throw new Error('This localhost demo requires DEMO_TOKEN and cannot run in production');
  }
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
}

void bootstrap();
