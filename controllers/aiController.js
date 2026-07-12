const Trade = require("../models/Trade");
const Setting = require("../models/Setting");

const round = (value, decimals = 2) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Number(number.toFixed(decimals));
};

const getPerformanceSummary = async (req, res, next) => {
  try {
    const rawDays = String(req.query.days ?? "30").trim();

    if (!/^\d{1,3}$/.test(rawDays)) {
      return res.status(400).json({
        success: false,
        message: "Days must be a whole number between 1 and 365.",
      });
    }

    const days = Number(rawDays);

    if (days < 1 || days > 365) {
      return res.status(400).json({
        success: false,
        message: "Days must be between 1 and 365.",
      });
    }

    const dateTo = new Date();
    const dateFrom = new Date(
      dateTo.getTime() - days * 24 * 60 * 60 * 1000
    );

    const [trades, settings] = await Promise.all([
      Trade.find({
        user: req.user._id,
        tradeDate: {
          $gte: dateFrom,
          $lte: dateTo,
        },
      })
        .select(
          "symbol tradeDate session result profitLoss commission rr mistakeTags"
        )
        .sort({ tradeDate: -1, createdAt: -1 })
        .lean(),

      Setting.findOne({
        user: req.user._id,
      })
        .select("currency timezone")
        .lean(),
    ]);

    const closedTrades = trades.filter(
      (trade) => trade.result !== "Open"
    );

    const openTrades = trades.filter(
      (trade) => trade.result === "Open"
    );

    const wins = closedTrades.filter(
      (trade) => trade.result === "Win"
    );

    const losses = closedTrades.filter(
      (trade) => trade.result === "Loss"
    );

    const breakeven = closedTrades.filter(
      (trade) => trade.result === "Breakeven"
    );

    const positiveTrades = closedTrades.filter(
      (trade) => Number(trade.profitLoss || 0) > 0
    );

    const negativeTrades = closedTrades.filter(
      (trade) => Number(trade.profitLoss || 0) < 0
    );

    const grossProfit = positiveTrades.reduce(
      (total, trade) => total + Number(trade.profitLoss || 0),
      0
    );

    const grossLoss = Math.abs(
      negativeTrades.reduce(
        (total, trade) => total + Number(trade.profitLoss || 0),
        0
      )
    );

    const totalCommission = closedTrades.reduce(
      (total, trade) => total + Number(trade.commission || 0),
      0
    );

    const pnlBeforeCommission = closedTrades.reduce(
      (total, trade) => total + Number(trade.profitLoss || 0),
      0
    );

    const netPnl = pnlBeforeCommission - totalCommission;
    const decisiveTrades = wins.length + losses.length;

    const winRate =
      decisiveTrades > 0
        ? (wins.length / decisiveTrades) * 100
        : 0;

    const averageWin =
      positiveTrades.length > 0
        ? grossProfit / positiveTrades.length
        : 0;

    const averageLoss =
      negativeTrades.length > 0
        ? grossLoss / negativeTrades.length
        : 0;

    const profitFactor =
      grossLoss > 0 ? grossProfit / grossLoss : null;

    const rrValues = closedTrades
      .map((trade) => Number(trade.rr))
      .filter((value) => Number.isFinite(value));

    const averageRR =
      rrValues.length > 0
        ? rrValues.reduce((total, value) => total + value, 0) /
          rrValues.length
        : 0;

    const sortedByPnl = [...closedTrades].sort(
      (first, second) =>
        Number(first.profitLoss || 0) -
        Number(second.profitLoss || 0)
    );

    const formatTrade = (trade) => {
      if (!trade) {
        return null;
      }

      const profitLoss = Number(trade.profitLoss || 0);
      const commission = Number(trade.commission || 0);

      return {
        id: trade._id,
        symbol: trade.symbol,
        tradeDate: trade.tradeDate,
        result: trade.result,
        profitLoss: round(profitLoss),
        commission: round(commission),
        netPnl: round(profitLoss - commission),
      };
    };

    const sessionMap = new Map();

    for (const trade of closedTrades) {
      const sessionName = trade.session || "Other";

      if (!sessionMap.has(sessionName)) {
        sessionMap.set(sessionName, {
          session: sessionName,
          trades: 0,
          wins: 0,
          losses: 0,
          breakeven: 0,
          netPnl: 0,
        });
      }

      const session = sessionMap.get(sessionName);

      session.trades += 1;
      session.netPnl +=
        Number(trade.profitLoss || 0) -
        Number(trade.commission || 0);

      if (trade.result === "Win") session.wins += 1;
      if (trade.result === "Loss") session.losses += 1;
      if (trade.result === "Breakeven") session.breakeven += 1;
    }

    const sessionPerformance = Array.from(sessionMap.values())
      .map((session) => {
        const decisive = session.wins + session.losses;

        return {
          ...session,
          netPnl: round(session.netPnl),
          winRate:
            decisive > 0
              ? round((session.wins / decisive) * 100)
              : 0,
        };
      })
      .sort((first, second) => second.netPnl - first.netPnl);

    const mistakeMap = new Map();

    for (const trade of closedTrades) {
      for (const rawTag of trade.mistakeTags || []) {
        const label = String(rawTag).trim();

        if (!label) continue;

        const key = label.toLowerCase();
        const existing = mistakeMap.get(key);

        if (existing) {
          existing.count += 1;
        } else {
          mistakeMap.set(key, {
            mistake: label,
            count: 1,
          });
        }
      }
    }

    const commonMistakes = Array.from(mistakeMap.values())
      .sort((first, second) => second.count - first.count)
      .slice(0, 10);

    res.status(200).json({
      success: true,
      source: "getPerformanceSummary",
      data: {
        period: {
          days,
          from: dateFrom,
          to: dateTo,
          timezone: settings?.timezone || "Asia/Kolkata",
        },

        currency: settings?.currency || "USD",

        totals: {
          allTrades: trades.length,
          closedTrades: closedTrades.length,
          openTrades: openTrades.length,
          wins: wins.length,
          losses: losses.length,
          breakeven: breakeven.length,
        },

        performance: {
          pnlBeforeCommission: round(pnlBeforeCommission),
          totalCommission: round(totalCommission),
          netPnl: round(netPnl),
          grossProfit: round(grossProfit),
          grossLoss: round(grossLoss),
          winRate: round(winRate),
          averageWin: round(averageWin),
          averageLoss: round(averageLoss),
          profitFactor:
            profitFactor === null ? null : round(profitFactor),
          averageRR: round(averageRR),
          bestTrade: formatTrade(
            sortedByPnl[sortedByPnl.length - 1]
          ),
          worstTrade: formatTrade(sortedByPnl[0]),
        },

        sessionPerformance,
        commonMistakes,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPerformanceSummary,
};
