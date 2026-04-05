import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/test-app.helper';
import { cleanDatabase, disconnectPrisma } from './helpers/prisma-test.helper';
import { FeatureFlagService } from '../../src/services/feature-flag.service';

describe('FeatureFlag HTTP (e2e)', () => {
  let app: INestApplication;
  let service: FeatureFlagService;

  beforeAll(async () => {
    app = await createTestApp();
    service = app.get(FeatureFlagService);
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  describe('GET /test/open (no guard)', () => {
    it('should return 200 without any flag', async () => {
      const res = await request(app.getHttpServer()).get('/test/open');
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('no guard');
    });
  });

  describe('GET /test/gated (@FeatureFlag)', () => {
    it('should return 403 when flag does not exist', async () => {
      const res = await request(app.getHttpServer()).get('/test/gated');
      expect(res.status).toBe(403);
    });

    it('should return 403 when flag is disabled', async () => {
      await service.create({ key: 'GATED_ENDPOINT', enabled: false });
      const res = await request(app.getHttpServer()).get('/test/gated');
      expect(res.status).toBe(403);
    });

    it('should return 200 when flag is enabled', async () => {
      await service.create({ key: 'GATED_ENDPOINT', enabled: true });
      const res = await request(app.getHttpServer()).get('/test/gated');
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('behind feature flag');
    });

    it('should return 200 when user has an override', async () => {
      await service.create({ key: 'GATED_ENDPOINT', enabled: false });
      await service.setOverride('GATED_ENDPOINT', { userId: 'user-1', enabled: true });

      const res = await request(app.getHttpServer())
        .get('/test/gated')
        .set('x-user-id', 'user-1');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /test/premium (custom statusCode/fallback)', () => {
    it('should return 402 with custom fallback when flag is disabled', async () => {
      await service.create({ key: 'PREMIUM', enabled: false });
      const res = await request(app.getHttpServer()).get('/test/premium');
      expect(res.status).toBe(402);
      expect(res.body.message).toBe('Upgrade required');
    });
  });

  describe('GET /test/bypassed (@BypassFeatureFlag)', () => {
    it('should return 200 even when flag does not exist', async () => {
      const res = await request(app.getHttpServer()).get('/test/bypassed');
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('always accessible');
    });
  });
});
