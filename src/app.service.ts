import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AutoRecommendationRequestDto,
  LiquiditySweepSignal,
  MlTargetSignal,
  StockAnalysisRequestDto,
  TrainMlModelRequestDto,
} from './app.dto';

type MarketBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

type StrategyStyle = 'DAY_TRADING' | 'SWING_TRADING' | 'SCALPING';

type MlFeatureWeights = {
  rsi: number;
  macdHistogram: number;
  volumeRatio: number;
  bidOfferImbalance: number;
  emaSpreadPercent: number;
  foreignFlowBillion: number;
  brokerNetBuyTop3Billion: number;
};

@Injectable()
export class AppService {
  private mlWeights: MlFeatureWeights = {
    rsi: 0.18,
    macdHistogram: 1.2,
    volumeRatio: 0.65,
    bidOfferImbalance: 1.4,
    emaSpreadPercent: 0.75,
    foreignFlowBillion: 0.08,
    brokerNetBuyTop3Billion: 0.12,
  };

  private mlBias = -0.35;
  private mlTrainingMeta = {
    trainedSamples: 0,
    epochs: 0,
    learningRate: 0,
    lastTrainedAt: null as string | null,
  };

  getInfo() {
    return {
      appName: 'StockPilot IDX Analyzer',
      version: '1.1.0',
      description:
        'API rekomendasi saham Indonesia berbasis indikator teknikal, liquidity sweep, dan bid-offer.',
      endpoints: {
        recommendation: 'POST /stock-analysis/recommendation',
        recommendationAuto: 'POST /stock-analysis/recommendation/auto',
        marketData: 'GET /stock-analysis/market-data/:symbol',
        tradingView: 'GET /stock-analysis/tradingview/:symbol',
        trainMl: 'POST /stock-analysis/ml/train',
      },
      ml: {
        enabled: true,
        note: 'Model logistic regression sederhana untuk kalibrasi probabilitas BUY/SELL.',
        training: this.mlTrainingMeta,
      },
    };
  }

  async getMarketData(symbol: string) {
    const normalized = this.normalizeIdxSymbol(symbol);
    const chartUrl =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normalized)}` +
      '?interval=1d&range=6mo';

    const response = await fetch(chartUrl, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new BadRequestException(
        `Gagal ambil data pasar untuk ${normalized}. Status: ${response.status}`,
      );
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];

    if (!result?.indicators?.quote?.[0]) {
      throw new BadRequestException(
        `Data saham ${normalized} tidak tersedia dari provider saat ini.`,
      );
    }

    const closes = (result.indicators.quote[0].close || []).filter(
      (value: number | null) => typeof value === 'number',
    ) as number[];

    const volumes = (result.indicators.quote[0].volume || []).filter(
      (value: number | null) => typeof value === 'number',
    ) as number[];

    if (closes.length < 60 || volumes.length < 30) {
      throw new BadRequestException(
        `Data historis ${normalized} belum cukup untuk menghitung indikator.`,
      );
    }

    const closePrice = closes[closes.length - 1];
    const ema20 = this.getLastEma(closes, 20);
    const ema50 = this.getLastEma(closes, 50);
    const rsi = this.getLastRsi(closes, 14);
    const macdHistogram = this.getLastMacdHistogram(closes);
    const volumeRatio = this.getVolumeRatio(volumes, 20);

    return {
      symbol: normalized,
      closePrice: this.round(closePrice),
      indicators: {
        rsi: this.round(rsi),
        macdHistogram: this.round(macdHistogram),
        volumeRatio: this.round(volumeRatio),
        ema20: this.round(ema20),
        ema50: this.round(ema50),
      },
      source: {
        provider: 'Yahoo Finance',
        range: '6mo',
        interval: '1d',
      },
    };
  }

  getTradingViewConfig(symbol: string, indicators?: string[]) {
    const cleanSymbol = symbol.toUpperCase().replace('.JK', '').trim();
    const parsedIndicators =
      indicators && indicators.length
        ? indicators
        : ['RSI', 'MACD', 'VWAP', 'EMA 20', 'EMA 50', 'Volume'];

    return {
      symbol: `IDX:${cleanSymbol}`,
      defaultInterval: '60',
      exchange: 'IDX',
      indicators: parsedIndicators,
      chartUrl: `https://www.tradingview.com/chart/?symbol=IDX%3A${encodeURIComponent(cleanSymbol)}`,
    };
  }

  async generateAutoRecommendation(payload: AutoRecommendationRequestDto) {
    const marketData = await this.getMarketData(payload.symbol);

    const recommendationPayload: StockAnalysisRequestDto = {
      symbol: marketData.symbol,
      closePrice: marketData.closePrice,
      rsi: marketData.indicators.rsi,
      macdHistogram: marketData.indicators.macdHistogram,
      volumeRatio: marketData.indicators.volumeRatio,
      liquiditySweep: payload.liquiditySweep,
      bidOfferImbalance: payload.bidOfferImbalance,
      ema20: marketData.indicators.ema20,
      ema50: marketData.indicators.ema50,
      foreignFlowBillion: payload.foreignFlowBillion,
      brokerNetBuyTop3Billion: payload.brokerNetBuyTop3Billion,
      tradingViewIndicators: payload.tradingViewIndicators,
    };

    return {
      marketData,
      recommendation: this.generateRecommendation(recommendationPayload),
    };
  }

  generateRecommendation(payload: StockAnalysisRequestDto) {
    const longScore = this.calculateLongScore(payload);
    const shortScore = this.calculateShortScore(payload);
    const ml = this.getMlPrediction(payload);
    const marketBias = this.getMarketBias(
      longScore,
      shortScore,
      ml.probabilityBuy,
    );

    return {
      symbol: payload.symbol.toUpperCase(),
      generatedAt: new Date().toISOString(),
      methodology: ['TECHNICAL_INDICATORS', 'LIQUIDITY_SWEEP', 'BID_OFFER'],
      marketBias,
      scoring: {
        longScore,
        shortScore,
        confidence: this.getConfidence(
          longScore,
          shortScore,
          ml.probabilityBuy,
        ),
        mlProbabilityBuy: this.round(ml.probabilityBuy),
        mlSignal: ml.signal,
        mlNote:
          'Probabilitas BUY dari model logistic regression yang bisa dilatih ulang memakai data historis Anda.',
      },
      brokerSummary: {
        foreignFlowBillion: payload.foreignFlowBillion,
        top3BrokerNetBuyBillion: payload.brokerNetBuyTop3Billion,
        interpretation:
          payload.foreignFlowBillion > 0 && payload.brokerNetBuyTop3Billion > 0
            ? 'Afirmasi akumulasi dari asing dan broker utama.'
            : payload.foreignFlowBillion < 0 &&
                payload.brokerNetBuyTop3Billion < 0
              ? 'Distribusi dominan, perlu disiplin risk management.'
              : 'Flow campuran, prioritaskan konfirmasi harga dan volume.',
      },
      strategies: {
        dayTrading: this.buildStrategy(payload.closePrice, marketBias, {
          style: 'DAY_TRADING',
          entryBufferPercent: 0.25,
          takeProfitPercent: 1.8,
          trailingStopPercent: 0.5,
          stopLossPercent: 0.8,
        }),
        swingTrading: this.buildStrategy(payload.closePrice, marketBias, {
          style: 'SWING_TRADING',
          entryBufferPercent: 0.5,
          takeProfitPercent: 6,
          trailingStopPercent: 1.5,
          stopLossPercent: 3,
        }),
        scalping: this.buildStrategy(payload.closePrice, marketBias, {
          style: 'SCALPING',
          entryBufferPercent: 0.15,
          takeProfitPercent: 0.9,
          trailingStopPercent: 0.25,
          stopLossPercent: 0.45,
        }),
      },
      tradingView: this.getTradingViewConfig(
        payload.symbol,
        payload.tradingViewIndicators,
      ),
      disclaimer:
        'Rekomendasi ini bersifat edukatif, bukan nasihat keuangan. Tetap lakukan analisis mandiri.',
    };
  }

  trainMlModel(payload: TrainMlModelRequestDto) {
    const learningRate = payload.learningRate ?? 0.08;
    const epochs = payload.epochs ?? 250;

    const gradients: MlFeatureWeights = {
      rsi: 0,
      macdHistogram: 0,
      volumeRatio: 0,
      bidOfferImbalance: 0,
      emaSpreadPercent: 0,
      foreignFlowBillion: 0,
      brokerNetBuyTop3Billion: 0,
    };

    for (let epoch = 0; epoch < epochs; epoch++) {
      gradients.rsi = 0;
      gradients.macdHistogram = 0;
      gradients.volumeRatio = 0;
      gradients.bidOfferImbalance = 0;
      gradients.emaSpreadPercent = 0;
      gradients.foreignFlowBillion = 0;
      gradients.brokerNetBuyTop3Billion = 0;
      let biasGradient = 0;

      for (const sample of payload.samples) {
        const features = this.normalizeMlFeatures({
          rsi: sample.rsi,
          macdHistogram: sample.macdHistogram,
          volumeRatio: sample.volumeRatio,
          bidOfferImbalance: sample.bidOfferImbalance,
          emaSpreadPercent: sample.emaSpreadPercent,
          foreignFlowBillion: sample.foreignFlowBillion,
          brokerNetBuyTop3Billion: sample.brokerNetBuyTop3Billion,
        });

        const y = sample.target === MlTargetSignal.BUY ? 1 : 0;
        const p = this.sigmoid(
          this.dot(features, this.mlWeights) + this.mlBias,
        );
        const error = p - y;

        gradients.rsi += error * features.rsi;
        gradients.macdHistogram += error * features.macdHistogram;
        gradients.volumeRatio += error * features.volumeRatio;
        gradients.bidOfferImbalance += error * features.bidOfferImbalance;
        gradients.emaSpreadPercent += error * features.emaSpreadPercent;
        gradients.foreignFlowBillion += error * features.foreignFlowBillion;
        gradients.brokerNetBuyTop3Billion +=
          error * features.brokerNetBuyTop3Billion;
        biasGradient += error;
      }

      const size = payload.samples.length;
      this.mlWeights.rsi -= learningRate * (gradients.rsi / size);
      this.mlWeights.macdHistogram -=
        learningRate * (gradients.macdHistogram / size);
      this.mlWeights.volumeRatio -=
        learningRate * (gradients.volumeRatio / size);
      this.mlWeights.bidOfferImbalance -=
        learningRate * (gradients.bidOfferImbalance / size);
      this.mlWeights.emaSpreadPercent -=
        learningRate * (gradients.emaSpreadPercent / size);
      this.mlWeights.foreignFlowBillion -=
        learningRate * (gradients.foreignFlowBillion / size);
      this.mlWeights.brokerNetBuyTop3Billion -=
        learningRate * (gradients.brokerNetBuyTop3Billion / size);
      this.mlBias -= learningRate * (biasGradient / size);
    }

    const accuracy = this.getTrainingAccuracy(payload.samples);

    this.mlTrainingMeta = {
      trainedSamples: payload.samples.length,
      epochs,
      learningRate,
      lastTrainedAt: new Date().toISOString(),
    };

    return {
      status: 'MODEL_UPDATED',
      training: {
        ...this.mlTrainingMeta,
        trainAccuracy: this.round(accuracy * 100),
      },
      weights: {
        ...this.mlWeights,
        bias: this.round(this.mlBias),
      },
    };
  }

  private calculateLongScore(payload: StockAnalysisRequestDto) {
    let score = 0;

    if (payload.rsi >= 50 && payload.rsi <= 68) score += 2;
    if (payload.macdHistogram > 0) score += 2;
    if (payload.closePrice > payload.ema20) score += 2;
    if (payload.ema20 > payload.ema50) score += 1;
    if (payload.volumeRatio >= 1.2) score += 2;
    if (payload.bidOfferImbalance >= 0.2) score += 2;
    if (payload.liquiditySweep === LiquiditySweepSignal.BULLISH) score += 2;
    if (payload.foreignFlowBillion > 0) score += 1;
    if (payload.brokerNetBuyTop3Billion > 0) score += 1;

    return score;
  }

  private calculateShortScore(payload: StockAnalysisRequestDto) {
    let score = 0;

    if (payload.rsi <= 45) score += 2;
    if (payload.macdHistogram < 0) score += 2;
    if (payload.closePrice < payload.ema20) score += 2;
    if (payload.ema20 < payload.ema50) score += 1;
    if (payload.volumeRatio >= 1.2) score += 1;
    if (payload.bidOfferImbalance <= -0.2) score += 2;
    if (payload.liquiditySweep === LiquiditySweepSignal.BEARISH) score += 2;
    if (payload.foreignFlowBillion < 0) score += 1;
    if (payload.brokerNetBuyTop3Billion < 0) score += 1;

    return score;
  }

  private getMarketBias(
    longScore: number,
    shortScore: number,
    mlProbabilityBuy: number,
  ): MarketBias {
    const mlAdjustment = (mlProbabilityBuy - 0.5) * 6;
    const combinedScore = longScore - shortScore + mlAdjustment;

    if (combinedScore >= 3) return 'BULLISH';
    if (combinedScore <= -3) return 'BEARISH';
    return 'NEUTRAL';
  }

  private getConfidence(
    longScore: number,
    shortScore: number,
    mlProbabilityBuy: number,
  ) {
    const delta =
      Math.abs(longScore - shortScore) + Math.abs(mlProbabilityBuy - 0.5) * 4;

    if (delta >= 6) return 'HIGH';
    if (delta >= 3) return 'MEDIUM';
    return 'LOW';
  }

  private buildStrategy(
    closePrice: number,
    bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    config: {
      style: StrategyStyle;
      entryBufferPercent: number;
      takeProfitPercent: number;
      trailingStopPercent: number;
      stopLossPercent: number;
    },
  ) {
    if (bias === 'NEUTRAL') {
      return {
        style: config.style,
        recommendation: 'WAIT',
        entry: null,
        takeProfit: null,
        trailingStop: null,
        stopLoss: null,
        cutLoss: null,
        note: 'Bias netral, tunggu konfirmasi breakout/breakdown berikutnya.',
      };
    }

    const direction = bias === 'BULLISH' ? 1 : -1;
    const entry =
      closePrice * (1 + (direction * config.entryBufferPercent) / 100);
    const takeProfit =
      entry * (1 + (direction * config.takeProfitPercent) / 100);
    const trailingStop =
      entry * (1 - (direction * config.trailingStopPercent) / 100);
    const stopLoss = entry * (1 - (direction * config.stopLossPercent) / 100);

    return {
      style: config.style,
      recommendation: bias === 'BULLISH' ? 'BUY' : 'SELL',
      entry: this.round(entry),
      takeProfit: this.round(takeProfit),
      trailingStop: this.round(trailingStop),
      stopLoss: this.round(stopLoss),
      cutLoss: this.round(stopLoss),
      note:
        bias === 'BULLISH'
          ? 'Entry saat pullback valid di atas area demand intraday.'
          : 'Entry saat retest gagal ke area supply intraday.',
    };
  }

  private round(value: number) {
    return Math.round(value * 100) / 100;
  }

  private normalizeIdxSymbol(symbol: string) {
    const normalized = symbol.toUpperCase().trim().replace('.JK', '');
    return `${normalized}.JK`;
  }

  private getLastEma(values: number[], period: number) {
    const k = 2 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private getLastRsi(values: number[], period: number) {
    if (values.length <= period) {
      throw new BadRequestException('Data tidak cukup untuk menghitung RSI.');
    }

    let gain = 0;
    let loss = 0;

    for (let i = 1; i <= period; i++) {
      const diff = values[i] - values[i - 1];
      if (diff >= 0) gain += diff;
      else loss += Math.abs(diff);
    }

    let avgGain = gain / period;
    let avgLoss = loss / period;

    for (let i = period + 1; i < values.length; i++) {
      const diff = values[i] - values[i - 1];
      const currentGain = diff > 0 ? diff : 0;
      const currentLoss = diff < 0 ? Math.abs(diff) : 0;

      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private getLastMacdHistogram(values: number[]) {
    const ema12Series = this.buildEmaSeries(values, 12);
    const ema26Series = this.buildEmaSeries(values, 26);
    const macdLine = ema12Series.map(
      (ema12, index) => ema12 - ema26Series[index],
    );
    const signalLine = this.buildEmaSeries(macdLine, 9);
    return macdLine[macdLine.length - 1] - signalLine[signalLine.length - 1];
  }

  private buildEmaSeries(values: number[], period: number) {
    const k = 2 / (period + 1);
    const series: number[] = [values[0]];
    for (let i = 1; i < values.length; i++) {
      series.push(values[i] * k + series[i - 1] * (1 - k));
    }
    return series;
  }

  private getVolumeRatio(volumes: number[], lookback: number) {
    const current = volumes[volumes.length - 1];
    const recent = volumes.slice(-lookback - 1, -1);
    const avg = recent.reduce((sum, vol) => sum + vol, 0) / recent.length;
    return avg > 0 ? current / avg : 1;
  }

  private getMlPrediction(payload: StockAnalysisRequestDto) {
    const emaSpreadPercent =
      ((payload.ema20 - payload.ema50) / payload.closePrice) * 100;
    const features = this.normalizeMlFeatures({
      rsi: payload.rsi,
      macdHistogram: payload.macdHistogram,
      volumeRatio: payload.volumeRatio,
      bidOfferImbalance: payload.bidOfferImbalance,
      emaSpreadPercent,
      foreignFlowBillion: payload.foreignFlowBillion,
      brokerNetBuyTop3Billion: payload.brokerNetBuyTop3Billion,
    });

    const probabilityBuy = this.sigmoid(
      this.dot(features, this.mlWeights) + this.mlBias,
    );
    const signal =
      probabilityBuy >= 0.58 ? 'BUY' : probabilityBuy <= 0.42 ? 'SELL' : 'HOLD';

    return { probabilityBuy, signal };
  }

  private normalizeMlFeatures(input: MlFeatureWeights): MlFeatureWeights {
    return {
      rsi: (input.rsi - 50) / 50,
      macdHistogram: input.macdHistogram,
      volumeRatio: (input.volumeRatio - 1) / 2,
      bidOfferImbalance: input.bidOfferImbalance,
      emaSpreadPercent: input.emaSpreadPercent / 10,
      foreignFlowBillion: input.foreignFlowBillion / 100,
      brokerNetBuyTop3Billion: input.brokerNetBuyTop3Billion / 100,
    };
  }

  private dot(features: MlFeatureWeights, weights: MlFeatureWeights) {
    return (
      features.rsi * weights.rsi +
      features.macdHistogram * weights.macdHistogram +
      features.volumeRatio * weights.volumeRatio +
      features.bidOfferImbalance * weights.bidOfferImbalance +
      features.emaSpreadPercent * weights.emaSpreadPercent +
      features.foreignFlowBillion * weights.foreignFlowBillion +
      features.brokerNetBuyTop3Billion * weights.brokerNetBuyTop3Billion
    );
  }

  private sigmoid(value: number) {
    return 1 / (1 + Math.exp(-value));
  }

  private getTrainingAccuracy(samples: TrainMlModelRequestDto['samples']) {
    let correct = 0;
    for (const sample of samples) {
      const p = this.sigmoid(
        this.dot(
          this.normalizeMlFeatures({
            rsi: sample.rsi,
            macdHistogram: sample.macdHistogram,
            volumeRatio: sample.volumeRatio,
            bidOfferImbalance: sample.bidOfferImbalance,
            emaSpreadPercent: sample.emaSpreadPercent,
            foreignFlowBillion: sample.foreignFlowBillion,
            brokerNetBuyTop3Billion: sample.brokerNetBuyTop3Billion,
          }),
          this.mlWeights,
        ) + this.mlBias,
      );

      const prediction = p >= 0.5 ? MlTargetSignal.BUY : MlTargetSignal.SELL;
      if (prediction === sample.target) correct += 1;
    }

    return correct / samples.length;
  }
}
