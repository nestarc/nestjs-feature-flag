import 'dotenv/config';
import { PrismaService } from './prisma.service';
import { FLAG_KEY } from './flag-key';

async function seed(): Promise<void> {
  const command = process.argv[2] ?? 'seed';
  if (!['seed', 'cleanup'].includes(command)) {
    throw new Error('Usage: npm run seed -- [seed|cleanup]');
  }
  const prisma = new PrismaService();
  try {
    if (command === 'cleanup') {
      await prisma.featureFlag.deleteMany({ where: { key: FLAG_KEY } });
      console.log(`Removed only ${FLAG_KEY}`);
      return;
    }
    await prisma.$transaction(async (tx) => {
      const flag = await tx.featureFlag.upsert({
        where: { key: FLAG_KEY },
        create: { key: FLAG_KEY, enabled: false, percentage: 0 },
        update: { enabled: false, percentage: 0, archivedAt: null },
      });
      await tx.featureFlagOverride.deleteMany({ where: { flagId: flag.id } });
      await tx.featureFlagOverride.create({
        data: {
          flagId: flag.id,
          attributes: { tenantId: 'tenant-acme', plan: 'pro' },
          priority: 10,
          enabled: true,
        },
      });
    });
    console.log(`${FLAG_KEY}: enabled only for tenant-acme with plan pro`);
  } finally {
    await prisma.$disconnect();
  }
}

void seed().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
