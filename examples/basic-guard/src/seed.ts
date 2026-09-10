import 'dotenv/config';
import { PrismaService } from './prisma.service';
import { FLAG_KEY } from './flag-key';

async function seed(): Promise<void> {
  const command = process.argv[2] ?? 'off';
  if (!['on', 'off', 'cleanup'].includes(command)) {
    throw new Error('Usage: npm run seed -- on|off|cleanup');
  }
  const prisma = new PrismaService();
  try {
    if (command === 'cleanup') {
      await prisma.featureFlag.deleteMany({ where: { key: FLAG_KEY } });
      console.log(`Removed only ${FLAG_KEY}`);
      return;
    }
    await prisma.featureFlag.upsert({
      where: { key: FLAG_KEY },
      create: { key: FLAG_KEY, enabled: command === 'on', percentage: 0 },
      update: { enabled: command === 'on', percentage: 0, archivedAt: null },
    });
    console.log(`${FLAG_KEY}: ${command}`);
  } finally {
    await prisma.$disconnect();
  }
}

void seed().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
