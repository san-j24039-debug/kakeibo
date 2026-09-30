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

  return {transactionTotals, normalizeBalances, computeBalances, initialBalancesForCurrent};
});
