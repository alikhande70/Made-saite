import { adminRoute } from '@/lib/admin-http';
import { IMPORT_TEMPLATE_CSV } from '@/application/import-service';
import { NextResponse } from 'next/server';

/** Downloadable column template, so nobody has to guess the header names. */
export const GET = adminRoute(async () => {
  // The BOM makes Excel open the Persian header row as UTF-8 rather than
  // mojibake — the single most common cause of "the template is broken".
  return new NextResponse(`﻿${IMPORT_TEMPLATE_CSV}\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="made-saite-import-template.csv"',
    },
  });
});
