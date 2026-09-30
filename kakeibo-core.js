(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.KakeiboCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  function finiteNumber(value, fallback = 0){
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function transactionTotals(transactions){
    return (Array.isArray(transactions) ? transactions : []).reduce((totals, transaction)=>{
      const amount = finiteNumber(transaction.amount);
      if(amount <= 0 || !['income', 'expense', 'transfer'].includes(transaction.type)) return totals;
      if(transaction.type === 'transfer'){
        totals.bank -= amount;
        totals.cash += amount;
        return totals;
      }
      const change = transaction.type === 'income' ? amount : -amount;
      if(transaction.source === 'bank') totals.bank += change;
      else totals.cash += change;
      return totals;
    }, {cash: 0, bank: 0});
  }

  function normalizeBalances(value){
    const source = value && typeof value === 'object' ? value : {};
    const bankInitial = finiteNumber(source.bankInitial);
    const cashInitial = Object.prototype.hasOwnProperty.call(source, 'cashInitial')
      ? finiteNumber(source.cashInitial)
      : finiteNumber(source.totalInitial) - bankInitial;
    return {cashInitial, bankInitial, totalInitial: cashInitial + bankInitial};
  }

  function computeBalances(balances, transactions){
    const initial = normalizeBalances(balances);
    const changes = transactionTotals(transactions);
    const cash = initial.cashInitial + changes.cash;
    const bank = initial.bankInitial + changes.bank;
    return {total: cash + bank, cash, bank};
  }

  // The settings form accepts the real balance as it stands now. Reverse the
  // recorded transactions so future calculations reproduce that exact value.
  function initialBalancesForCurrent(current, transactions){
    const cash = finiteNumber(current.cash);
    const bank = finiteNumber(current.bank);
    const changes = transactionTotals(transactions);
    const cashInitial = cash - changes.cash;
    const bankInitial = bank - changes.bank;
    return {cashInitial, bankInitial, totalInitial: cashInitial + bankInitial};
  }

  function safeHttpUrl(value){
    const text = String(value || '').trim();
    if(!text) return '';
    try{
      const url = new URL(text);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch(error){
      return '';
    }
  }

  function memoTotal(memos){
    return (Array.isArray(memos) ? memos : []).reduce((total, memo)=>{
      return total + Math.max(0, finiteNumber(memo.amount));
    }, 0);
  }

  function monthKey(date){
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, '0')}`;
  }

  function shiftMonth(key, offset){
    const [year, month] = key.split('-').map(Number);
    return monthKey(new Date(year, month - 1 + offset, 1));
  }

  function periodStart(key, settings, isHoliday = ()=>false){
    const [year, month] = key.split('-').map(Number);
    if(settings.mode !== 'payday') return `${key}-01`;
    const day = Math.min(Number(settings.payday) || 1, new Date(year, month, 0).getDate());
    const date = new Date(year, month - 1, day);
    const adjustment = settings.holidayAdjustment || 'previous';
    if(adjustment !== 'none'){
      const step = adjustment === 'next' ? 1 : -1;
      while(date.getDay() === 0 || date.getDay() === 6 || isHoliday(monthKey(date) + '-' + String(date.getDate()).padStart(2, '0'))){
        date.setDate(date.getDate() + step);
      }
    }
    return `${monthKey(date)}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function periodForDate(dateString, settings, isHoliday = ()=>false){
    const date = new Date(`${dateString}T12:00:00`);
    const current = monthKey(date);
    const candidates = [-2, -1, 0, 1, 2].map(offset=>shiftMonth(current, offset));
    const start = candidates.filter(key=>periodStart(key, settings, isHoliday) <= dateString)
      .sort((a,b)=>periodStart(b, settings, isHoliday).localeCompare(periodStart(a, settings, isHoliday)))[0];
    const key = start || shiftMonth(current, -2);
    return {key, start: periodStart(key, settings, isHoliday), end: periodStart(shiftMonth(key, 1), settings, isHoliday)};
  }

  function budgetSummary(key, settings, entries, transactions, isHoliday = ()=>false){
    const entry = entries[key];
    if(!entry) return null;
    const start = periodStart(key, settings, isHoliday);
    const end = periodStart(shiftMonth(key, 1), settings, isHoliday);
    const previousKey = shiftMonth(key, -1);
    const previous = entries[previousKey]
      ? budgetSummary(previousKey, settings, entries, transactions, isHoliday) : null;
    const carry = entry.carryOverride == null ? (previous?.remaining || 0) : Number(entry.carryOverride);
    const salary = Number(entry.salary);
    const savingsGoal = Number(entry.savingsGoal);
    const spent = transactions.reduce((sum, item)=>{
      return item.type === 'expense' && item.date >= start && item.date < end
        ? sum + Number(item.amount) : sum;
    }, 0);
    const limit = salary - savingsGoal + carry;
    const remaining = limit - spent;
    const savingsEstimate = Math.max(0, savingsGoal - Math.max(0, -remaining));
    return {key, start, end, salary, savingsGoal, carry, carryFrom: entry.carryFrom || previousKey,
      limit, spent, remaining, savingsEstimate, shortage: Math.max(0, -remaining - savingsGoal)};
  }

  function calendarMonthReport(key, transactions){
    const totals = {key, income:0, expense:0, net:0, count:0};
    for(const item of transactions){
      if(item.date?.slice(0, 7) !== key) continue;
      const amount = Number(item.amount);
      if(!Number.isFinite(amount) || amount <= 0) continue;
      if(item.type === 'expense') totals.expense += amount;
      else if(item.type === 'income') totals.income += amount;
      else continue;
      totals.count++;
    }
    totals.net = totals.income - totals.expense;
    return totals;
  }

  function reportComparison(key, transactions){
    const current = calendarMonthReport(key, transactions);
    const previous = calendarMonthReport(shiftMonth(key, -1), transactions);
    const priorThree = [1, 2, 3].map(offset=>calendarMonthReport(shiftMonth(key, -offset), transactions));
    const chart = Array.from({length:6}, (_, index)=>
      calendarMonthReport(shiftMonth(key, index - 5), transactions));
    return {current, previous, difference:current.expense - previous.expense,
      priorThreeAverage:priorThree.reduce((sum, month)=>sum + month.expense, 0) / 3, chart};
  }

  function reconciliationEntries(current, actual, date, firstId){
    const cashDifference = Number(actual.cash) - Number(current.cash);
    const bankDifference = Number(actual.bank) - Number(current.bank);
    if(Number.isFinite(cashDifference) && cashDifference > 0 && bankDifference === -cashDifference){
      return [{id:firstId, type:'transfer', source:'bank', amount:cashDifference,
        date, place:'残高差額（銀行→現金）'}];
    }
    const entries = [];
    for(const source of ['cash', 'bank']){
      const difference = Number(actual[source]) - Number(current[source]);
      if(!Number.isFinite(difference) || difference === 0) continue;
      entries.push({id:firstId + entries.length, type:difference < 0 ? 'expense' : 'income',
        source, amount:Math.abs(difference), date, place:'残高差額（未記録）'});
    }
    return entries;
  }

  return {transactionTotals, normalizeBalances, computeBalances, initialBalancesForCurrent,
    safeHttpUrl, memoTotal, shiftMonth, periodStart, periodForDate, budgetSummary,
    calendarMonthReport, reportComparison, reconciliationEntries};
});
