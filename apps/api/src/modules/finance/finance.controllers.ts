import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { RequirePermission } from '../../auth/decorators';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { CashService } from './cash.service';
import { ExpensesService } from './expenses.service';
import {
  CashHistoryQuery, CashQuery, CloseCash, EditCategory, ExpenseDecision, ExpenseRejection, ExpenseSettings, ExpensesQuery, NewCategory, NewExpense, OpenCash, ReopenCash, VoidExpense,
} from './finance.schemas';

const id = new ParseUUIDPipe();
type Body<T extends z.ZodTypeAny> = z.infer<T>;

/**
 * Expenses (SRS EXP-001…004). Recording: expenses:write, or expenses:write:cash for reception's cash expenses
 * (checked in the service, CLR-03). Approving, categories and the reception limit: expenses:approve (the owner).
 */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(@Query(new ZodBody(ExpensesQuery)) q: Body<typeof ExpensesQuery>) {
    return this.expenses.list(q);
  }

  @Post()
  create(@Body(new ZodBody(NewExpense)) body: Body<typeof NewExpense>) {
    return this.expenses.create(body);
  }

  @Get('pending')
  @RequirePermission('expenses:approve')
  pending() {
    return this.expenses.pending();
  }

  @Get('categories')
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

  @Get('settings')
  @RequirePermission('expenses:approve')
  settings() {
    return this.expenses.settings();
  }

  @Patch('settings')
  @RequirePermission('expenses:approve')
  setSettings(@Body(new ZodBody(ExpenseSettings)) body: Body<typeof ExpenseSettings>) {
    return this.expenses.setSettings(body.receptionLimitMinor);
  }

  @Get(':id')
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
  void(@Param('id', id) expenseId: string, @Body(new ZodBody(VoidExpense)) body: Body<typeof VoidExpense>) {
    return this.expenses.void(expenseId, body.reason);
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
