const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {runInNewContext} = require('node:vm');
const {
  computeBalances,
  normalizeBalances,
  initialBalancesForCurrent,
  safeHttpUrl,
  memoTotal,
  shiftMonth,
  migrateBudgetPeriodLabels,
  periodStart,
  periodForDate,
  budgetSummary,
  balanceFloorSummary,
  calendarMonthReport,
  reportComparison,
  isSalaryIncome,
  periodMonthReport,
  periodReportComparison,
  reconciliationEntries
} = require('../kakeibo-core.js');

test('the page inline script parses', ()=>{
  const source = readFileSync(require.resolve('../index.html'), 'utf8');
  const match = source.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match);
  assert.doesNotThrow(()=>new Function(match[1]));
});

test('initial cash and bank balances are shown without transactions', ()=>{
  assert.deepEqual(
    computeBalances({cashInitial: 12000, bankInitial: 88000}, []),
    {cash: 12000, bank: 88000, total: 100000}
  );
});

test('income and expenses affect only their selected account', ()=>{
  const transactions = [
    {type: 'income', source: 'bank', amount: 200000},
    {type: 'expense', source: 'bank', amount: 65000},
    {type: 'expense', source: 'cash', amount: 3200},
    {type: 'income', source: 'cash', amount: 500}
  ];
  assert.deepEqual(
    computeBalances({cashInitial: 10000, bankInitial: 50000}, transactions),
    {cash: 7300, bank: 185000, total: 192300}
  );
});

test('reconciling after a forgotten entry makes the displayed balance exact', ()=>{
  const transactions = [
    {type: 'expense', source: 'cash', amount: 1000},
    {type: 'expense', source: 'bank', amount: 8000}
  ];
  const initial = initialBalancesForCurrent({cash: 4500, bank: 72000}, transactions);
  assert.deepEqual(computeBalances(initial, transactions), {cash: 4500, bank: 72000, total: 76500});
});

test('transactions added, edited, or deleted after reconciliation still change balances', ()=>{
  const oldTransactions = [{type: 'expense', source: 'cash', amount: 1000}];
  const initial = initialBalancesForCurrent({cash: 5000, bank: 20000}, oldTransactions);
  assert.equal(computeBalances(initial, [...oldTransactions, {type: 'expense', source: 'cash', amount: 600}]).cash, 4400);
  assert.equal(computeBalances(initial, [{type: 'expense', source: 'cash', amount: 400}]).cash, 5600);
  assert.equal(computeBalances(initial, []).cash, 6000);
});

test('legacy total and bank data is migrated to separate cash and bank values', ()=>{
  assert.deepEqual(
    normalizeBalances({totalInitial: 100000, bankInitial: 75000}),
    {cashInitial: 25000, bankInitial: 75000, totalInitial: 100000}
  );
});

test('negative balances are supported', ()=>{
  const initial = initialBalancesForCurrent({cash: -500, bank: -1200}, []);
  assert.deepEqual(computeBalances(initial, []), {cash: -500, bank: -1200, total: -1700});
});

test('a bank-to-cash transfer moves money without changing the total balance', ()=>{
  const transactions = [{type: 'transfer', source: 'bank', amount: 10000}];
  assert.deepEqual(
    computeBalances({cashInitial: 5000, bankInitial: 50000}, transactions),
    {cash: 15000, bank: 40000, total: 55000}
  );
});

test('reconciling balances also accounts for existing transfers', ()=>{
  const transactions = [{type: 'transfer', source: 'bank', amount: 7000}];
  const initial = initialBalancesForCurrent({cash: 12000, bank: 43000}, transactions);
  assert.deepEqual(computeBalances(initial, transactions), {cash: 12000, bank: 43000, total: 55000});
});

test('memo links allow only http and https URLs', ()=>{
  assert.equal(safeHttpUrl('https://example.com/item'), 'https://example.com/item');
  assert.equal(safeHttpUrl('javascript:alert(1)'), '');
  assert.equal(safeHttpUrl('not a url'), '');
});

test('memo total adds valid non-negative planned amounts', ()=>{
  assert.equal(memoTotal([{amount: 3000}, {amount: '2500'}, {amount: -10}, {amount: 'x'}]), 5500);
});

test('calendar periods begin on the first even when payday is set', ()=>{
  const settings = {mode: 'calendar', payday: 25};
  assert.deepEqual(periodForDate('2026-10-01', settings),
    {key: '2026-10', start: '2026-10-01', end: '2026-11-01'});
});

test('payday period begins on the previous business day when a holiday follows a weekend', ()=>{
  const settings = {mode: 'payday', payday: 25, holidayAdjustment: 'previous'};
  const holiday = date=>date === '2026-05-25';
  assert.equal(periodStart('2026-06', settings, holiday), '2026-05-22');
  assert.equal(periodForDate('2026-05-21', settings, holiday).key, '2026-05');
  assert.equal(periodForDate('2026-05-22', settings, holiday).key, '2026-06');
});

test('payday 31 uses month end and can shift into the previous month', ()=>{
  const settings = {mode: 'payday', payday: 31, holidayAdjustment: 'previous'};
  assert.equal(periodStart('2026-03', settings), '2026-02-27');
  assert.equal(periodStart('2026-06', settings), '2026-05-29');
  const firstDay = {mode: 'payday', payday: 1, holidayAdjustment: 'previous'};
  assert.equal(periodStart('2026-02', firstDay,
    date=>date === '2026-01-01' || date === '2025-12-31'), '2025-12-30');
});

test('payday can use the next business day or no adjustment', ()=>{
  const settings = {mode: 'payday', payday: 25, holidayAdjustment: 'next'};
  assert.equal(periodStart('2026-11', settings, date=>date === '2026-10-26'), '2026-10-27');
  assert.equal(periodStart('2026-11', {...settings, holidayAdjustment:'none'}), '2026-10-25');
});

test('September 28 payday opens the October budget on October 1', ()=>{
  const settings = {mode:'payday', payday:28, holidayAdjustment:'previous'};
  assert.deepEqual(periodForDate('2026-10-01', settings),
    {key:'2026-10', start:'2026-09-28', end:'2026-10-28'});
  assert.equal(periodForDate('2026-09-27', settings).key, '2026-09');
  assert.equal(periodForDate('2026-09-28', settings).key, '2026-10');
  const entries = {'2026-10':{salary:100000,savingsGoal:50000,carryOverride:0}};
  const summary = budgetSummary('2026-10', settings, entries, [
    {type:'expense',date:'2026-09-27',amount:3000},
    {type:'expense',date:'2026-09-28',amount:1000},
    {type:'expense',date:'2026-10-27',amount:2000},
    {type:'expense',date:'2026-10-28',amount:4000}
  ]);
  assert.equal(summary.spent, 3000);
});

test('older payday budgets move to the following month without losing settings', ()=>{
  const old = {mode:'payday', entries:{
    '2026-08':{salary:90000,savingsGoal:40000,carryOverride:0,carryFrom:'2026-07'},
    '2026-09':{salary:100000,savingsGoal:50000,carryOverride:null,carryFrom:'2026-08'}
  }};
  const migrated = migrateBudgetPeriodLabels(old);
  assert.equal(migrated.periodVersion, 2);
  assert.deepEqual(Object.keys(migrated.entries), ['2026-09','2026-10']);
  assert.equal(migrated.entries['2026-10'].salary, 100000);
  assert.equal(migrated.entries['2026-10'].carryFrom, '2026-09');
  assert.equal(migrateBudgetPeriodLabels(migrated), migrated);
  const calendar = migrateBudgetPeriodLabels({mode:'calendar',entries:{'2026-09':old.entries['2026-09']}});
  assert.deepEqual(Object.keys(calendar.entries), ['2026-09']);
});

test('unused budget carries forward and overspending reduces the savings estimate', ()=>{
  const settings = {mode:'calendar'};
  const entries = {
    '2026-06': {salary:100000, savingsGoal:50000, carryOverride:0},
    '2026-07': {salary:100000, savingsGoal:50000, carryOverride:null},
    '2026-08': {salary:100000, savingsGoal:50000, carryOverride:null}
  };
  const transactions = [
    {type:'expense', amount:40000, date:'2026-06-10'},
    {type:'transfer', amount:10000, date:'2026-06-15'},
    {type:'expense', amount:70000, date:'2026-07-12'}
  ];
  const june = budgetSummary('2026-06', settings, entries, transactions);
  const july = budgetSummary('2026-07', settings, entries, transactions);
  const august = budgetSummary('2026-08', settings, entries, transactions);
  assert.equal(june.remaining, 10000);
  assert.equal(july.carry, 10000);
  assert.equal(july.remaining, -10000);
  assert.equal(july.savingsEstimate, 40000);
  assert.equal(august.carry, -10000);
  assert.equal(august.limit, 40000);
});

test('a manual carry is attributed to the previous month and shortage cannot make savings negative', ()=>{
  const entries = {'2026-07': {salary:100000, savingsGoal:50000, carryOverride:-10000}};
  const result = budgetSummary('2026-07', {mode:'calendar'}, entries,
    [{type:'expense', amount:100000, date:'2026-07-10'}]);
  assert.equal(result.carryFrom, '2026-06');
  assert.equal(result.remaining, -60000);
  assert.equal(result.savingsEstimate, 0);
  assert.equal(result.shortage, 10000);
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('editing a prior expense recalculates the following period carry', ()=>{
  const entries = {
    '2026-06': {salary:100000, savingsGoal:50000, carryOverride:0},
    '2026-07': {salary:100000, savingsGoal:50000, carryOverride:null}
  };
  const settings = {mode:'calendar'};
  const original = [{type:'expense', amount:40000, date:'2026-06-08'}];
  const edited = [{type:'expense', amount:60000, date:'2026-06-08'}];
  assert.equal(budgetSummary('2026-07', settings, entries, original).carry, 10000);
  assert.equal(budgetSummary('2026-07', settings, entries, edited).carry, -10000);
});

test('the app holiday calendar includes 2026 bridge and substitute holidays', ()=>{
  const source = readFileSync(require.resolve('../index.html'), 'utf8');
  const start = source.indexOf('function localDateStr(');
  const end = source.indexOf('function dateToneClass(');
  assert.ok(start >= 0 && end > start);
  const holidays = runInNewContext(`${source.slice(start, end)}\njapaneseHolidays(2026)`);
  for(const date of ['2026-05-06', '2026-09-22', '2026-10-12']){
    assert.equal(holidays.has(date), true, `${date} should be a holiday`);
  }
});

test('monthly report includes income and expenses but excludes transfers', ()=>{
  const transactions = [
    {type:'income', amount:100000, date:'2026-07-01'},
    {type:'expense', amount:12000, date:'2026-07-10'},
    {type:'expense', amount:8000, date:'2026-07-31'},
    {type:'transfer', amount:30000, date:'2026-07-15'},
    {type:'expense', amount:9000, date:'2026-08-01'}
  ];
  assert.deepEqual(calendarMonthReport('2026-07', transactions),
    {key:'2026-07', income:100000, expense:20000, net:80000, count:3});
});

test('report comparison and six month chart use distinct calendar months', ()=>{
  const transactions = [
    {type:'expense', amount:10000, date:'2026-04-01'},
    {type:'expense', amount:20000, date:'2026-05-01'},
    {type:'expense', amount:30000, date:'2026-06-01'},
    {type:'expense', amount:45000, date:'2026-07-01'}
  ];
  const report = reportComparison('2026-07', transactions);
  assert.equal(report.difference, 15000);
  assert.equal(report.priorThreeAverage, 20000);
  assert.deepEqual(report.chart.map(month=>month.key),
    ['2026-02','2026-03','2026-04','2026-05','2026-06','2026-07']);
});

test('reconciliation creates one dated adjustment per independently changed account', ()=>{
  const current = {cash:1000, bank:11000};
  const actual = {cash:500, bank:10000};
  const entries = reconciliationEntries(current, actual, '2026-09-30', 900);
  assert.deepEqual(entries.map(({id,type,source,amount,date})=>({id,type,source,amount,date})), [
    {id:900,type:'expense',source:'cash',amount:500,date:'2026-09-30'},
    {id:901,type:'expense',source:'bank',amount:1000,date:'2026-09-30'}
  ]);
  assert.deepEqual(computeBalances({cashInitial:1000,bankInitial:11000}, entries),
    {cash:500,bank:10000,total:10500});
});

test('an unrecorded bank withdrawal is reconciled as a transfer', ()=>{
  const entries = reconciliationEntries({cash:1000,bank:11000}, {cash:2000,bank:10000}, '2026-09-30', 900);
  assert.deepEqual(entries.map(({type,source,amount})=>({type,source,amount})),
    [{type:'transfer',source:'bank',amount:1000}]);
  assert.equal(calendarMonthReport('2026-09', entries).expense, 0);
  assert.deepEqual(computeBalances({cashInitial:1000,bankInitial:11000}, entries),
    {cash:2000,bank:10000,total:12000});
});

test('forgotten expense enters the selected month and affects budget carry', ()=>{
  const entries = reconciliationEntries({cash:5000,bank:0}, {cash:2000,bank:0}, '2026-06-29', 1);
  assert.equal(calendarMonthReport('2026-06', entries).expense, 3000);
  const budgetEntries = {
    '2026-06': {salary:10000,savingsGoal:5000,carryOverride:0},
    '2026-07': {salary:10000,savingsGoal:5000,carryOverride:null}
  };
  assert.equal(budgetSummary('2026-06', {mode:'calendar'}, budgetEntries, entries).remaining, 2000);
  assert.equal(budgetSummary('2026-07', {mode:'calendar'}, budgetEntries, entries).carry, 2000);
});

test('a directly entered spending budget does not require salary or savings fields', ()=>{
  const settings = {mode:'calendar'};
  const entries = {'2026-10':{baseLimit:50000, salary:null, savingsGoal:null, carryOverride:0}};
  const spent = [{type:'expense',amount:5000,date:'2026-10-10'}];
  const result = budgetSummary('2026-10', settings, entries, spent);
  assert.equal(result.baseLimit, 50000);
  assert.equal(result.remaining, 45000);
  assert.equal(result.savingsEstimate, null);
});

test('changing the budget mid-period immediately updates the remaining amount and next carry', ()=>{
  const settings = {mode:'calendar'};
  const entries = {
    '2026-10':{baseLimit:50000, salary:null, savingsGoal:null, carryOverride:0},
    '2026-11':{baseLimit:40000, salary:null, savingsGoal:null, carryOverride:null}
  };
  const spent = [{type:'expense',amount:12000,date:'2026-10-15'}];
  assert.equal(budgetSummary('2026-10', settings, entries, spent).remaining, 38000);
  entries['2026-10'].baseLimit = 60000;
  assert.equal(budgetSummary('2026-10', settings, entries, spent).remaining, 48000);
  assert.equal(budgetSummary('2026-11', settings, entries, spent).carry, 48000);
});

test('older salary-minus-savings budgets retain their original limit', ()=>{
  const old = {'2026-10':{salary:114063,savingsGoal:50000,carryOverride:0}};
  const result = budgetSummary('2026-10', {mode:'calendar'}, old,
    [{type:'expense',amount:5000,date:'2026-10-01'}]);
  assert.equal(result.baseLimit, 64063);
  assert.equal(result.remaining, 59063);
  old['2026-10'].baseLimit = 50000;
  assert.equal(budgetSummary('2026-10', {mode:'calendar'}, old,
    [{type:'expense',amount:5000,date:'2026-10-01'}]).remaining, 45000);
});

test('a directly chosen budget can differ from salary minus savings goal', ()=>{
  const entries = {'2026-10':{salary:100000,savingsGoal:50000,baseLimit:40000,carryOverride:0}};
  const result = budgetSummary('2026-10', {mode:'calendar'}, entries,
    [{type:'expense',amount:5000,date:'2026-10-08'}]);
  assert.equal(result.remaining, 35000);
  assert.equal(result.savingsEstimate, 50000);
  entries['2026-10'].baseLimit = 60000;
  const revised = budgetSummary('2026-10', {mode:'calendar'}, entries,
    [{type:'expense',amount:5000,date:'2026-10-08'}]);
  assert.equal(revised.remaining, 55000);
  assert.equal(revised.plannedSavingsShortfall, 10000);
  assert.equal(revised.savingsEstimate, 40000);
});

test('a balance floor of 100000 leaves 70000 spendable from 170000 total', ()=>{
  const settings = {mode:'calendar'};
  const balances = {cashInitial:20000, bankInitial:150000};
  const transactions = [];
  const summary = ()=>balanceFloorSummary('2026-10', settings, 100000, balances, transactions, '2026-10');
  assert.equal(summary().remaining, 70000);
  transactions.push({type:'expense',source:'cash',amount:5000,date:'2026-10-25'});
  assert.equal(summary().remaining, 65000);
  transactions.push({type:'transfer',source:'bank',amount:10000,date:'2026-10-26'});
  assert.equal(summary().remaining, 65000);
  transactions.push({type:'income',source:'bank',amount:20000,date:'2026-10-27'});
  assert.equal(summary().remaining, 85000);
  assert.equal(balanceFloorSummary('2026-10', settings, 190000, balances, transactions, '2026-10').remaining, -5000);
});

test('past balance-floor periods exclude later income and expenses', ()=>{
  const transactions = [
    {type:'expense',source:'cash',amount:10000,date:'2026-10-20'},
    {type:'income',source:'bank',amount:30000,date:'2026-11-02'},
    {type:'expense',source:'bank',amount:5000,date:'2026-11-03'},
    {type:'transfer',source:'bank',amount:2000,date:'2026-11-04'}
  ];
  const summary = balanceFloorSummary('2026-10', {mode:'calendar'}, 100000,
    {cashInitial:20000, bankInitial:150000}, transactions, '2026-11');
  assert.equal(summary.balance, 160000);
  assert.equal(summary.remaining, 60000);
  assert.equal(summary.spent, 10000);
});

test('an older spending budget after a balance-floor period does not produce NaN', ()=>{
  const entries = {
    '2026-10':{floorBalance:100000},
    '2026-11':{baseLimit:50000,carryOverride:null}
  };
  const summary = budgetSummary('2026-11', {mode:'calendar'}, entries, []);
  assert.equal(summary.carry, 0);
  assert.equal(summary.remaining, 50000);
});

test('monthly remainder is income minus expenses and ignores bank-to-cash transfers', ()=>{
  const items = [
    {type:'income',amount:150000,date:'2026-10-01'},
    {type:'expense',amount:50000,date:'2026-10-10'},
    {type:'transfer',amount:20000,date:'2026-10-11'}
  ];
  const month = calendarMonthReport('2026-10', items);
  assert.equal(month.income, 150000);
  assert.equal(month.expense, 50000);
  assert.equal(month.net, 100000);
});

test('salary income is distinct from other income and remains backward compatible', ()=>{
  assert.equal(isSalaryIncome({type:'income',incomeKind:'salary',place:'会社'}), true);
  assert.equal(isSalaryIncome({type:'income',place:'給料'}), true);
  assert.equal(isSalaryIncome({type:'income',place:'10月分の給料'}), true);
  assert.equal(isSalaryIncome({type:'income',incomeKind:'other',place:'給料'}), false);
  assert.equal(isSalaryIncome({type:'income',place:'お小遣い'}), false);
});

test('a 28th payday assigns the salary and spending to the following budget month', ()=>{
  const settings = {mode:'payday',payday:28,holidayAdjustment:'none'};
  const entries = [
    {type:'income',incomeKind:'salary',source:'bank',amount:110000,date:'2026-10-28'},
    {type:'income',incomeKind:'other',source:'cash',amount:5000,date:'2026-10-29'},
    {type:'expense',source:'bank',amount:45000,date:'2026-11-02'},
    {type:'transfer',source:'bank',amount:10000,date:'2026-11-03'},
    {type:'expense',source:'cash',amount:5000,date:'2026-11-04'}
  ];
  const report = periodMonthReport('2026-11', settings, entries);
  assert.equal(report.start, '2026-10-28');
  assert.equal(report.end, '2026-11-28');
  assert.equal(report.salary, 110000);
  assert.equal(report.otherIncome, 5000);
  assert.equal(report.expense, 50000);
  assert.equal(report.salaryUsed, 50000);
  assert.equal(report.salaryRemaining, 60000);
  assert.equal(periodMonthReport('2026-10', settings, entries).salary, 0);
});

test('salary-used amount is capped at salary and empty salary stays zero', ()=>{
  const items = [
    {type:'income',incomeKind:'salary',amount:30000,date:'2026-10-01'},
    {type:'expense',amount:40000,date:'2026-10-02'}
  ];
  const report = periodMonthReport('2026-10', {mode:'calendar'}, items);
  assert.equal(report.salaryUsed, 30000);
  assert.equal(report.salaryRemaining, 0);
  const comparison = periodReportComparison('2026-11', {mode:'calendar'}, items);
  assert.equal(comparison.previous.salary, 30000);
  assert.equal(comparison.current.salaryUsed, 0);
  assert.equal(comparison.chart.length, 6);
});
