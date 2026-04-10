import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FeatureFlagModule } from '../../src/feature-flag.module';
import { FeatureFlagAdminController } from '../../src/admin/feature-flag-admin.controller';
import { getPrisma, cleanDatabase, disconnectPrisma } from './helpers/prisma-test.helper';

/**
 * Wire the admin controller directly into the global module's scope.
 *
 * FeatureFlagAdminModule.register() uses ModuleRef.get() to bridge the
 * FeatureFlagService across module boundaries. In @nestjs/testing this can
 * fail due to module initialization ordering differences. By registering
 * the controller alongside the global FeatureFlagModule and manually
 * setting its route prefix, we test the same HTTP endpoints with the
 * real service instance that forRoot() provides.
 */
describe('FeatureFlagAdmin REST (e2e)', () => {
  let app: INestApplication;
  const prisma = getPrisma();

  beforeAll(async () => {
    // Set the controller path — normally done by FeatureFlagAdminModule.register()
    Reflect.defineMetadata('path', 'feature-flags', FeatureFlagAdminController);

    const module = await Test.createTestingModule({
      imports: [
        FeatureFlagModule.forRoot({
          environment: 'test',
          prisma,
          cacheTtlMs: 0,
        }),
      ],
      controllers: [FeatureFlagAdminController],
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
    expect(res.body).toEqual(
      expect.objectContaining({ key: 'NEW_FLAG', enabled: true }),
    );
  });

  // ── READ (list) ────────────────────────────────

  it('GET /feature-flags — should list all non-archived flags', async () => {
    await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'A', enabled: true });
    await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'B', enabled: false });

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
    await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'UPD', enabled: false });

    const res = await request(app.getHttpServer())
      .patch('/feature-flags/UPD')
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  // ── ARCHIVE ────────────────────────────────────

  it('DELETE /feature-flags/:key — should archive a flag', async () => {
    await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'ARC', enabled: true });

    const res = await request(app.getHttpServer()).delete('/feature-flags/ARC');
    expect(res.status).toBe(200);
    expect(res.body.archivedAt).not.toBeNull();

    // Archived flag should not appear in list
    const listRes = await request(app.getHttpServer()).get('/feature-flags');
    expect(listRes.body).toHaveLength(0);
  });

  // ── OVERRIDE: set ──────────────────────────────

  it('POST /feature-flags/:key/overrides — should set an override', async () => {
    await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'OVR', enabled: false });

    const res = await request(app.getHttpServer())
      .post('/feature-flags/OVR/overrides')
      .send({ userId: 'u-1', enabled: true });

    expect(res.status).toBe(201);

    // Verify override is persisted
    const flagRes = await request(app.getHttpServer()).get('/feature-flags/OVR');
    expect(flagRes.body.overrides).toHaveLength(1);
    expect(flagRes.body.overrides[0].userId).toBe('u-1');
  });

  it('POST /feature-flags/:key/overrides — should return 404 for unknown flag (Finding #1 fix)', async () => {
    const res = await request(app.getHttpServer())
      .post('/feature-flags/GHOST/overrides')
      .send({ userId: 'u-1', enabled: true });

    expect(res.status).toBe(404);
  });

  // ── OVERRIDE: remove ───────────────────────────

  it('DELETE /feature-flags/:key/overrides — should remove an override', async () => {
    await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'RMO', enabled: false });
    await request(app.getHttpServer())
      .post('/feature-flags/RMO/overrides')
      .send({ userId: 'u-1', enabled: true });

    const res = await request(app.getHttpServer())
      .delete('/feature-flags/RMO/overrides')
      .send({ userId: 'u-1' });

    expect(res.status).toBe(200);

    const flagRes = await request(app.getHttpServer()).get('/feature-flags/RMO');
    expect(flagRes.body.overrides).toHaveLength(0);
  });

  it('DELETE /feature-flags/:key/overrides — should return 404 for unknown flag', async () => {
    const res = await request(app.getHttpServer())
      .delete('/feature-flags/GHOST/overrides')
      .send({ userId: 'u-1' });

    expect(res.status).toBe(404);
  });

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
      .send({ tenantId: 't-1', enabled: true });

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
      .send({ tenantId: 't-1' });

    const afterRemoveRes = await request(app.getHttpServer()).get('/feature-flags/LIFECYCLE');
    expect(afterRemoveRes.body.overrides).toHaveLength(0);

    // 6. Archive
    const archiveRes = await request(app.getHttpServer()).delete('/feature-flags/LIFECYCLE');
    expect(archiveRes.body.archivedAt).not.toBeNull();
  });
});
