const test = require("node:test");
const assert = require("node:assert/strict");

const Trade = require("../models/Trade");
const Setting = require("../models/Setting");
const {
  getPerformanceSummary,
} = require("../controllers/aiController");

const createQuery = (result) => ({
  select() {
    return this;
  },
  sort() {
    return this;
  },
  lean() {
    return Promise.resolve(result);
  },
});

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

test("returns a verified 30-day performance summary", async () => {
  const originalFind = Trade.find;
  const originalFindOne = Setting.findOne;

  const recentDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const trades = [
    {
      _id: "trade-win",
      symbol: "NIFTY",
      tradeDate: recentDate,
      session: "London",
      result: "Win",
      profitLoss: 500,
      commission: 10,
      rr: 2,
      mistakeTags: [],
    },
    {
      _id: "trade-loss-one",
      symbol: "BANKNIFTY",
      tradeDate: recentDate,
      session: "New York",
      result: "Loss",
      profitLoss: -300,
      commission: 5,
      rr: -1,
      mistakeTags: ["Revenge Trading"],
    },
    {
      _id: "trade-loss-two",
      symbol: "ETHUSD",
      tradeDate: recentDate,
      session: "New York",
      result: "Loss",
      profitLoss: -200,
      commission: 5,
      rr: -1,
      mistakeTags: ["revenge trading"],
    },
    {
      _id: "trade-open",
      symbol: "BTCUSD",
      tradeDate: recentDate,
      session: "Other",
      result: "Open",
      profitLoss: 100,
      commission: 0,
      rr: 0,
      mistakeTags: [],
    },
  ];

  Trade.find = () => createQuery(trades);
  Setting.findOne = () =>
    createQuery({
      currency: "INR",
      timezone: "Asia/Kolkata",
    });

  const req = {
    query: { days: "30" },
    user: { _id: "test-user" },
  };
  const res = createResponse();

  try {
    await getPerformanceSummary(req, res, (error) => {
      throw error;
    });
  } finally {
    Trade.find = originalFind;
    Setting.findOne = originalFindOne;
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.source, "getPerformanceSummary");
  assert.equal(res.body.data.currency, "INR");

  assert.deepEqual(res.body.data.totals, {
    allTrades: 4,
    closedTrades: 3,
    openTrades: 1,
    wins: 1,
    losses: 2,
    breakeven: 0,
  });

  assert.equal(res.body.data.performance.pnlBeforeCommission, 0);
  assert.equal(res.body.data.performance.totalCommission, 20);
  assert.equal(res.body.data.performance.netPnl, -20);
  assert.equal(res.body.data.performance.grossProfit, 500);
  assert.equal(res.body.data.performance.grossLoss, 500);
  assert.equal(res.body.data.performance.winRate, 33.33);
  assert.equal(res.body.data.performance.averageWin, 500);
  assert.equal(res.body.data.performance.averageLoss, 250);
  assert.equal(res.body.data.performance.profitFactor, 1);
  assert.equal(res.body.data.performance.averageRR, 0);
  assert.equal(res.body.data.performance.bestTrade.netPnl, 490);
  assert.equal(res.body.data.performance.worstTrade.netPnl, -305);

  assert.deepEqual(res.body.data.commonMistakes, [
    {
      mistake: "Revenge Trading",
      count: 2,
    },
  ]);

  assert.equal(res.body.data.sessionPerformance[0].session, "London");
  assert.equal(res.body.data.sessionPerformance[0].netPnl, 490);
  assert.equal(res.body.data.sessionPerformance[1].session, "New York");
  assert.equal(res.body.data.sessionPerformance[1].netPnl, -510);
});

test("rejects an invalid date range before querying MongoDB", async () => {
  const originalFind = Trade.find;
  const originalFindOne = Setting.findOne;
  let databaseWasCalled = false;

  Trade.find = () => {
    databaseWasCalled = true;
    return createQuery([]);
  };

  Setting.findOne = () => {
    databaseWasCalled = true;
    return createQuery(null);
  };

  const req = {
    query: { days: "999" },
    user: { _id: "test-user" },
  };
  const res = createResponse();

  try {
    await getPerformanceSummary(req, res, (error) => {
      throw error;
    });
  } finally {
    Trade.find = originalFind;
    Setting.findOne = originalFindOne;
  }

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(databaseWasCalled, false);
});
