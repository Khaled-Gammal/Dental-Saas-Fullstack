import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { Public, RequirePermission } from '../../auth/decorators';
import { EXPENSE_FILE_POLICY } from '../../config';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { CashService } from './cash.service';
import { ExpensesService } from './expenses.service';
import {
  CashHistoryQuery, CashQuery, CloseCash, EditCategory, ExpenseDecision, ExpenseRejection, ExpensesQuery, NewCategory, NewExpense, OpenCash, ReopenCash, VoidExpense,
} from './finance.schemas';

const id = new ParseUUIDPipe();
type Body<T extends z.ZodTypeAny> = z.infer<T>;

/**
 * Expenses (SRS EXP-001…004): the owner's and the accountant's (owner 2026-10-20; reception has no access). Reading:
 * expenses:read; recording, voiding, documents: expenses:write. Approving (what reception recorded before) and
 * categories: expenses:approve (the owner).
 */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequirePermission('expenses:read')
  list(@Query(new ZodBody(ExpensesQuery)) q: Body<typeof ExpensesQuery>) {
    return this.expenses.list(q);
  }

  @Post()
  @RequirePermission('expenses:write')
  create(@Body(new ZodBody(NewExpense)) body: Body<typeof NewExpense>) {
    return this.expenses.create(body);
  }

  @Get('pending')
  @RequirePermission('expenses:approve')
  pending() {
    return this.expenses.pending();
  }

  @Get('categories')
  @RequirePermission('expenses:read')
  categories() {
    return this.expenses.categories();
  }

  @Post('categories')
  @RequirePermission('expenses:approve')
  addCategory(@Body(new ZodBody(NewCategory)) body: Body<typeof NewCategory>) {
    return this.expenses.addCategory(body.name);
  }

  @Patch('categories/:id')
  @RequirePermission('expenses:approve')
  editCategory(@Param('id', id) categoryId: string, @Body(new ZodBody(EditCategory)) body: Body<typeof EditCategory>) {
    return this.expenses.editCategory(categoryId, body);
  }

  @Get(':id')
  @RequirePermission('expenses:read')
  get(@Param('id', id) expenseId: string) {
    return this.expenses.get(expenseId);
  }

  @Post(':id/approve') @HttpCode(200)
  @RequirePermission('expenses:approve')
  approve(@Param('id', id) expenseId: string, @Body(new ZodBody(ExpenseDecision)) body: Body<typeof ExpenseDecision>) {
    return this.expenses.decide(expenseId, true, body.note ?? null);
  }

  @Post(':id/reject') @HttpCode(200)
  @RequirePermission('expenses:approve')
  reject(@Param('id', id) expenseId: string, @Body(new ZodBody(ExpenseRejection)) body: Body<typeof ExpenseRejection>) {
    return this.expenses.decide(expenseId, false, body.note);
  }

  @Post(':id/void') @HttpCode(200)
  @RequirePermission('expenses:write')
  void(@Param('id', id) expenseId: string, @Body(new ZodBody(VoidExpense)) body: Body<typeof VoidExpense>) {
    return this.expenses.void(expenseId, body.reason);
  }

  /** EXP-001: the supporting document (multipart field `file`: PDF or image), attached once. The permission is checked before the body is read. */
  @Post(':id/document') @HttpCode(200)
  @RequirePermission('expenses:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: EXPENSE_FILE_POLICY.maxUploadBytes, files: 1, fields: 0 } }))
  attachDocument(@Param('id', id) expenseId: string, @UploadedFile() file: { buffer?: Buffer } | undefined) {
    return this.expenses.attachDocument(expenseId, file?.buffer ?? Buffer.alloc(0));
  }
}

const SignedQuery = z.object({ u: z.string().uuid(), exp: z.coerce.number().int(), sig: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) }).strict();

/** An expense document's 5-minute signed link (no session; the signature is bound to the member). */
@ApiTags('finance')
@Controller('expense-files')
export class ExpenseFileLinkController {
  constructor(private readonly expenses: ExpensesService) {}

  @Public()
  @Get(':tenantId/:fileId')
  async open(@Param('tenantId', id) tenantId: string, @Param('fileId', id) fileId: string, @Query(new ZodBody(SignedQuery)) q: z.infer<typeof SignedQuery>,
    @Res({ passthrough: true }) res: Response) {
    const f = await this.expenses.openDocument(tenantId, fileId, q.u, q.exp, q.sig);
    res.set({
      'Content-Type': f.mime, 'Content-Length': String(f.length), 'Content-Disposition': `inline; filename="${f.name}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    });
    return new StreamableFile(f.body as never);
  }
}

/** The daily cash box (SRS CASH-001…004, CLR-04). */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('cash')
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get('today')
  @RequirePermission('cash:operate')
  day(@Query(new ZodBody(CashQuery)) q: Body<typeof CashQuery>) {
    return this.cash.day(q.branchId);
  }

  @Get('branches')
  @RequirePermission('cash:operate')
  branches() {
    return this.cash.branches();
  }

  @Get('sessions')
  @RequirePermission('cash:operate')
  history(@Query(new ZodBody(CashHistoryQuery)) q: Body<typeof CashHistoryQuery>) {
    return this.cash.history(q);
  }

  @Post('sessions')
  @RequirePermission('cash:operate')
  open(@Body(new ZodBody(OpenCash)) body: Body<typeof OpenCash>) {
    return this.cash.open(body.branchId, body.openingMinor);
  }

  @Get('sessions/:id')
  @RequirePermission('cash:operate')
  get(@Param('id', id) sessionId: string) {
    return this.cash.get(sessionId);
  }

  /** Redesign R9: the payments, refunds and expenses behind the session's figures. */
  @Get('sessions/:id/movements')
  @RequirePermission('cash:operate')
  movements(@Param('id', id) sessionId: string) {
    return this.cash.movements(sessionId);
  }

  @Post('sessions/:id/close') @HttpCode(200)
  @RequirePermission('cash:operate')
  close(@Param('id', id) sessionId: string, @Body(new ZodBody(CloseCash)) body: Body<typeof CloseCash>) {
    return this.cash.close(sessionId, body.countedMinor, body.note ?? null);
  }

  @Post('sessions/:id/reopen') @HttpCode(200)
  @RequirePermission('cash:reopen')
  reopen(@Param('id', id) sessionId: string, @Body(new ZodBody(ReopenCash)) body: Body<typeof ReopenCash>) {
    return this.cash.reopen(sessionId, body.reason);
  }
}
