import { INestApplication, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FeatureFlagModule } from '../../src/feature-flag.module';
import { FeatureFlagAdminModule } from '../../src/admin/feature-flag-admin.module';
import { getPrisma, cleanDatabase, disconnectPrisma } from './helpers/prisma-test.helper';

@Injectable()
class NoopGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}

describe('FeatureFlagAdmin REST (e2e)', () => {
  let app: INestApplication;
  const prisma = getPrisma();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        FeatureFlagModule.forRoot({
          environment: 'test',
          prisma,
          cacheTtlMs: 0,
        }),
        FeatureFlagAdminModule.register({
          guard: NoopGuard,
          path: 'feature-flags',
        }),
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  // ── CREATE ─────────────────────────────────────

  it('POST /feature-flags — should create a flag', async () => {
    const res = await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'NEW_FLAG', enabled: true, description: 'e2e test' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ key: 'NEW_FLAG', enabled: true }));
  });

  it('POST /feature-flags - should return 400 for empty key', async () => {
    const res = await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: '', enabled: true });

    expect(res.status).toBe(400);
  });

  it('POST /feature-flags - should return 400 for invalid percentage', async () => {
    const res = await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'BAD_PERCENTAGE', percentage: -5 });

    expect(res.status).toBe(400);
  });

  it('POST /feature-flags/:key/overrides - should reject missing attributes', async () => {
    await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'MISSING_ATTRIBUTES', enabled: false });

    const res = await request(app.getHttpServer())
      .post('/feature-flags/MISSING_ATTRIBUTES/overrides')
      .send({ enabled: true });

    expect(res.status).toBe(400);
  });

  it('POST /feature-flags/:key/overrides - should reject legacy top-level tenantId body', async () => {
    await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'LEGACY_OVERRIDE_BODY', enabled: false });

    const res = await request(app.getHttpServer())
      .post('/feature-flags/LEGACY_OVERRIDE_BODY/overrides')
      .send({ tenantId: 't-1', enabled: true });

    expect(res.status).toBe(400);
  });

  it('POST /feature-flags/:key/overrides - should accept attribute override body', async () => {
    await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'ATTRIBUTE_OVERRIDE_BODY', enabled: false });

    const res = await request(app.getHttpServer())
      .post('/feature-flags/ATTRIBUTE_OVERRIDE_BODY/overrides')
      .send({
        attributes: { tenantId: 't-1', plan: 'pro' },
        enabled: true,
        priority: 10,
      });

    expect(res.status).toBe(201);

    const flagRes = await request(app.getHttpServer()).get(
      '/feature-flags/ATTRIBUTE_OVERRIDE_BODY',
    );
    expect(flagRes.body.overrides[0]).toEqual(
      expect.objectContaining({
        attributes: { tenantId: 't-1', plan: 'pro' },
        priority: 10,
        enabled: true,
      }),
    );
  });

  // ── READ (list) ────────────────────────────────

  it('GET /feature-flags — should list all non-archived flags', async () => {
    await request(app.getHttpServer()).post('/feature-flags').send({ key: 'A', enabled: true });
    await request(app.getHttpServer()).post('/feature-flags').send({ key: 'B', enabled: false });

    const res = await request(app.getHttpServer()).get('/feature-flags');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  // ── READ (single) ─────────────────────────────

  it('GET /feature-flags/:key — should return a single flag', async () => {
    await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'SINGLE', enabled: true });

    const res = await request(app.getHttpServer()).get('/feature-flags/SINGLE');
    expect(res.status).toBe(200);
    expect(res.body.key).toBe('SINGLE');
  });

  it('GET /feature-flags/:key — should return 404 for unknown flag', async () => {
    const res = await request(app.getHttpServer()).get('/feature-flags/NOPE');
    expect(res.status).toBe(404);
  });

  // ── UPDATE ─────────────────────────────────────

  it('PATCH /feature-flags/:key — should update a flag', async () => {
    await request(app.getHttpServer()).post('/feature-flags').send({ key: 'UPD', enabled: false });

    const res = await request(app.getHttpServer())
      .patch('/feature-flags/UPD')
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  it.each([null, -1, 101, 0.5, '50'])(
    'PATCH /feature-flags/:key — should reject percentage %p without changing the flag',
    async (percentage) => {
      await request(app.getHttpServer())
        .post('/feature-flags')
        .send({ key: 'INVALID_UPDATE', percentage: 25 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch('/feature-flags/INVALID_UPDATE')
        .send({ percentage });

      expect(res.status).toBe(400);
      const stored = await prisma.featureFlag.findUnique({ where: { key: 'INVALID_UPDATE' } });
      expect(stored?.percentage).toBe(25);
    },
  );

  it('PATCH /feature-flags/:key — should accept boundaries and preserve omitted percentage', async () => {
    await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'PERCENTAGE_BOUNDARIES', percentage: 100, description: 'clear me' })
      .expect(201);

    for (const percentage of [0, 100]) {
      const res = await request(app.getHttpServer())
        .patch('/feature-flags/PERCENTAGE_BOUNDARIES')
        .send({ percentage });
      expect(res.status).toBe(200);
      expect(res.body.percentage).toBe(percentage);
    }

    const cleared = await request(app.getHttpServer())
      .patch('/feature-flags/PERCENTAGE_BOUNDARIES')
      .send({ description: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ description: null, percentage: 100 });
  });

  // ── ARCHIVE ────────────────────────────────────

  it('DELETE /feature-flags/:key — should archive a flag', async () => {
    await request(app.getHttpServer()).post('/feature-flags').send({ key: 'ARC', enabled: true });

    const res = await request(app.getHttpServer()).delete('/feature-flags/ARC');
    expect(res.status).toBe(200);
    expect(res.body.archivedAt).not.toBeNull();

    // Archived flag should not appear in list
    const listRes = await request(app.getHttpServer()).get('/feature-flags');
    expect(listRes.body).toHaveLength(0);
  });

  // ── OVERRIDE: set ──────────────────────────────

  it('POST /feature-flags/:key/overrides — should set an override', async () => {
    await request(app.getHttpServer()).post('/feature-flags').send({ key: 'OVR', enabled: false });

    const res = await request(app.getHttpServer())
      .post('/feature-flags/OVR/overrides')
      .send({ attributes: { userId: 'u-1' }, enabled: true });

    expect(res.status).toBe(201);

    // Verify override is persisted
    const flagRes = await request(app.getHttpServer()).get('/feature-flags/OVR');
    expect(flagRes.body.overrides).toHaveLength(1);
    expect(flagRes.body.overrides[0].attributes).toEqual({ userId: 'u-1' });
  });

  it('POST /feature-flags/:key/overrides — should return 404 for unknown flag (Finding #1 fix)', async () => {
    const res = await request(app.getHttpServer())
      .post('/feature-flags/GHOST/overrides')
      .send({ attributes: { userId: 'u-1' }, enabled: true });

    expect(res.status).toBe(404);
  });

  // ── OVERRIDE: remove ───────────────────────────

  it('DELETE /feature-flags/:key/overrides — should remove an override', async () => {
    await request(app.getHttpServer()).post('/feature-flags').send({ key: 'RMO', enabled: false });
    await request(app.getHttpServer())
      .post('/feature-flags/RMO/overrides')
      .send({ attributes: { userId: 'u-1' }, enabled: true });

    const res = await request(app.getHttpServer())
      .delete('/feature-flags/RMO/overrides')
      .send({ attributes: { userId: 'u-1' } });

    expect(res.status).toBe(200);

    const flagRes = await request(app.getHttpServer()).get('/feature-flags/RMO');
    expect(flagRes.body.overrides).toHaveLength(0);
  });

  it('DELETE /feature-flags/:key/overrides — should return 404 for unknown flag', async () => {
    const res = await request(app.getHttpServer())
      .delete('/feature-flags/GHOST/overrides')
      .send({ attributes: { userId: 'u-1' } });

    expect(res.status).toBe(404);
  });

  it('POST /feature-flags/:key/evaluate — should bucket by a requested custom attribute', async () => {
    await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'ACCOUNT_ROLLOUT', percentage: 50, metadata: { bucketBy: 'userId' } })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/feature-flags/ACCOUNT_ROLLOUT/evaluate')
      .send({
        context: { userId: 'user-1', attributes: { accountId: 'account-1' } },
        bucketBy: 'accountId',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ source: 'percentage', targetingKey: 'account-1' });
    expect(res.body.bucket).toEqual(expect.any(Number));
  });

  it.each([null, '', 123])(
    'POST /feature-flags/:key/evaluate — should reject invalid bucketBy %p',
    async (bucketBy) => {
      await request(app.getHttpServer())
        .post('/feature-flags/ACCOUNT_ROLLOUT/evaluate')
        .send({ bucketBy })
        .expect(400);
    },
  );

  // ── Full CRUD cycle ────────────────────────────

  it('should complete a full lifecycle: create → override → read → archive', async () => {
    // 1. Create
    const createRes = await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'LIFECYCLE', enabled: false });
    expect(createRes.status).toBe(201);

    // 2. Set override
    await request(app.getHttpServer())
      .post('/feature-flags/LIFECYCLE/overrides')
      .send({ attributes: { tenantId: 't-1' }, enabled: true });

    // 3. Read and verify
    const readRes = await request(app.getHttpServer()).get('/feature-flags/LIFECYCLE');
    expect(readRes.body.overrides).toHaveLength(1);

    // 4. Update
    const updateRes = await request(app.getHttpServer())
      .patch('/feature-flags/LIFECYCLE')
      .send({ description: 'updated' });
    expect(updateRes.body.description).toBe('updated');

    // 5. Remove override
    await request(app.getHttpServer())
      .delete('/feature-flags/LIFECYCLE/overrides')
      .send({ attributes: { tenantId: 't-1' } });

    const afterRemoveRes = await request(app.getHttpServer()).get('/feature-flags/LIFECYCLE');
    expect(afterRemoveRes.body.overrides).toHaveLength(0);

    // 6. Archive
    const archiveRes = await request(app.getHttpServer()).delete('/feature-flags/LIFECYCLE');
    expect(archiveRes.body.archivedAt).not.toBeNull();
  });
});
