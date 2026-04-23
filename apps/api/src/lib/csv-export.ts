import { stringify } from 'csv-stringify';
import type { Response } from 'express';
import type { PrismaClient } from '@prisma/client';

const COLUMNS = [
  { key: 'email', header: 'Email' },
  { key: 'domain', header: 'Domain' },
  { key: 'status', header: 'Status' },
  { key: 'score', header: 'Score' },
  { key: 'confidence', header: 'Confidence' },
  { key: 'mxFound', header: 'MX Found' },
  { key: 'mxHost', header: 'MX Host' },
  { key: 'smtpReachable', header: 'SMTP Reachable' },
  { key: 'smtpCode', header: 'SMTP Code' },
  { key: 'smtpMessage', header: 'SMTP Message' },
  { key: 'isDisposable', header: 'Disposable' },
  { key: 'isRoleBased', header: 'Role-Based' },
  { key: 'isCatchAll', header: 'Catch-All' },
  { key: 'isHoneypot', header: 'Honeypot' },
  { key: 'responseTimeMs', header: 'Response Time (ms)' },
  { key: 'verifiedAt', header: 'Verified At' },
  { key: 'errorMessage', header: 'Error' },
];

export async function streamVerificationBatchCSV(
  prisma: PrismaClient,
  batchId: string,
  res: Response,
): Promise<void> {
  const batch = await prisma.emailVerificationBatch.findUnique({ where: { id: batchId } });
  if (!batch) {
    res.status(404).json({ error: 'Batch not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="verification-${batchId}.csv"`,
  );

  const stringifier = stringify({
    header: true,
    columns: COLUMNS,
  });

  stringifier.pipe(res);

  // Stream results in pages of 500
  const PAGE_SIZE = 500;
  let skip = 0;
  while (true) {
    const rows = await prisma.emailVerificationResult.findMany({
      where: { batchId },
      orderBy: { verifiedAt: 'asc' },
      skip,
      take: PAGE_SIZE,
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      stringifier.write({
        ...row,
        mxFound: row.mxFound ? 'Yes' : 'No',
        smtpReachable: row.smtpReachable ? 'Yes' : 'No',
        isDisposable: row.isDisposable ? 'Yes' : 'No',
        isRoleBased: row.isRoleBased ? 'Yes' : 'No',
        isCatchAll: row.isCatchAll ? 'Yes' : 'No',
        isHoneypot: row.isHoneypot ? 'Yes' : 'No',
        verifiedAt: row.verifiedAt.toISOString(),
        errorMessage: row.errorMessage ?? '',
        smtpMessage: row.smtpMessage ?? '',
        mxHost: row.mxHost ?? '',
      });
    }
    skip += PAGE_SIZE;
    if (rows.length < PAGE_SIZE) break;
  }

  stringifier.end();
}
