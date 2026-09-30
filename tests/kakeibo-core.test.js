const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeBalances,
  normalizeBalances,
  initialBalancesForCurrent
} = require('../kakeibo-core.js');

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
