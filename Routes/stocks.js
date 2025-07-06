const express = require("express");
const router = express.Router();
const { redisClient } = require("../redis");
const { getRedisClient } = require("../services/redisService");
const axios = require('axios');
const Stock = require("../Models/Stock");
const { GoogleGenerativeAI } = require("@google/generative-ai");


const ALPHA_VANTAGE_API = `https://${process.env.API_HOST}/query`;

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);

const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });


const formattedDate = () => new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');

const checkCache = (generateKey) => async (req, res, next) => {
    const key = generateKey(req);
    const redis = getRedisClient();

    if (!redis) {
        console.warn("Redis not available, skipping cache check.");
        return next();
    }

    try {
        const redisCacheData = await redis.get(key);

        if (redisCacheData) {
            console.log("Cache hit for key:", key);
            return res.status(200).json(JSON.parse(redisCacheData));
        } else {
            console.log("Cache miss for key:", key);
            next();
        }
    } catch (error) {
        console.error("Error accessing Redis cache:", error);
        next(); // Continue without cache if there's an error
    }
};

router.get('/stocksList', checkCache((req) => `List on ${formattedDate()}: c-${req.body.country}, e-${req.body.exchange}`), async (req, res, next) => {
    try {
        const stocksListEndpoint = `https://api.twelvedata.com/stocks?country=${req.body.country}&exchange=${req.body.exchange}`;
        const resp = await axios.get(stocksListEndpoint)

        const data = resp.data;

        if (resp.status === 200) {
            const redis = getRedisClient();
            if (redis) {
                await redis.set(`List on ${formattedDate()}: c-${req.body.country}, e-${req.body.exchange}`, JSON.stringify(data), { EX: process.env.DEFAULT_EXPIRATION_DURATION });
            }
            res.status(200).json(data);
        } else {
            return res.status(500).json(data)
        }
    } catch (error) {
        next(error);
    }

});


router.get('/companyDetails', checkCache((req) => `${req.query.symbol} Details`), async (req, res, next) => {
    try {
        const dataFromMongo = await Stock.findOne({ name: req.query.symbol });
        if (dataFromMongo) {
            console.log('mongo data found!');
            return res.status(200).json(dataFromMongo.data);
        } else {
            console.log('mongo data not found...calling gemini api');
            try {
                const prompt = `no extra text just respond with json obj including name, industry, description, siteUrl, logo and peers for ${req.query.symbol} symbol registered at BSE. return JSON object instead of string with exact same key name as mentioned and no nested object. Peers should be array of individual peer.`

                const result = await model.generateContent(prompt);
                const response = result.response;
                const text = response.text();
                const formattedRes = text.replace(/\n/g, '').replace(/```/g, '').replace(/json/g, '').replace(/\\"/g, '"').replace(/^"|"$/g, '');
                const formattedObj = JSON.parse(formattedRes)
                const mongoSave = new Stock({ name: req.query.symbol, data: formattedObj });
                await mongoSave.save();
                res.status(200).json(mongoSave);
            } catch (error) {
                console.error('Error calling Gemini API:', error.response ? error.response.data : error.message);
                next(error);
            }
        }
    } catch (error) {
        next(error);
    }
})

// Fetch Technical Analysis RSI data - Alpha Vantage API
router.get('/getRSIData', checkCache((req) => `${req.query.interval}RSI: ${req.query.symbol}`), async (req, res, next) => {
    try {
        const queries = req.query;
        const RSIEndpoint = {
            method: 'GET',
            url: ALPHA_VANTAGE_API,
            params: {
                datatype: process.env.DEFAULT_API_RESP_FORMAT,
                time_period: queries.timePeriod,
                interval: (queries.interval).toLowerCase(),
                series_type: queries.seriesType,
                symbol: queries.symbol,
                function: 'RSI'
            },
            headers: {
                'x-rapidapi-key': process.env.RAPIDAPI_TECHNICAL_RSI_DATA_API_KEY,
                'x-rapidapi-host': process.env.API_HOST
            }
        };
        const resp = await axios.request(RSIEndpoint)
        const data = resp.data;

        if (resp.status === 200 && !data.Information) {
            const rsi = data["Technical Analysis: RSI"];
            const values = Object.keys(rsi).map(datetime => ({
                datetime: datetime,
                rsi: rsi[datetime]["RSI"],
            }));

            const formattedResponse = {
                "meta": data["Meta Data"],
                "values": values.slice(0, 150)
            }
            const redis = getRedisClient();
            if (redis) {
                await redis.set(`${queries.interval}RSI: ${queries.symbol}`, JSON.stringify(formattedResponse), { EX: process.env.DEFAULT_EXPIRATION_DURATION });
            }
            res.status(200).json(formattedResponse);
        } else {
            return res.status(500).json(data)
        }
    } catch (error) {
        next(error);
    }
});

// Fetch TimeSeries data - Alpha Vantage API
router.get('/timeSeries', checkCache((req) => `${req.query.symbol} timeSeries ${req.query.interval}: ${formattedDate()}`), async (req, res, next) => {
    try {
        const timeSeriesEndpoint = {
            method: 'GET',
            url: ALPHA_VANTAGE_API,
            params: {
                outputsize: process.env.DEFAULT_API_OUTPUT_SIZE,
                symbol: req.query.symbol,
                function: `TIME_SERIES_${(req.query.interval).toUpperCase()}`,
                datatype: process.env.DEFAULT_API_RESP_FORMAT,
                ...((req.query.interval).toUpperCase() === 'INTRADAY' && { interval: '60min' })
            },
            headers: {
                'x-rapidapi-key': process.env.RAPIDAPI_TIMESERIES_DATA_API_KEY,
                'x-rapidapi-host': process.env.API_HOST
            }
        }

        const resp = await axios.request(timeSeriesEndpoint)
        const interval = (req.query.interval).toLowerCase()
        const data = resp.data;
        let timeSeriesDataKey;
        if (interval == "daily") {
            timeSeriesDataKey = "Time Series (Daily)"
        } else if (interval == "weekly") {
            timeSeriesDataKey = "Weekly Time Series"
        } else {
            timeSeriesDataKey = "Monthly Time Series"
        }
        const timeseries = data[timeSeriesDataKey]
        if (resp.status === 200 && !data.Information) {
            const values = Object.keys(timeseries).map(datetime => ({
                datetime: datetime,
                open: timeseries[datetime]["1. open"],
                high: timeseries[datetime]["2. high"],
                low: timeseries[datetime]["3. low"],
                close: timeseries[datetime]["4. close"],
                volume: timeseries[datetime]["5. volume"]
            }));

            const formattedResponse = {
                "meta": data["Meta Data"],
                "values": interval == 'daily' ? values.slice(0, 150) : interval == 'weekly' ? values.slice(0, 100) : values.slice(0, 50)
            }
            const redis = getRedisClient();
            if (redis) {
                await redis.set(`${req.query.symbol} timeSeries ${req.query.interval}: ${formattedDate()}`, JSON.stringify(formattedResponse), { EX: process.env.DEFAULT_EXPIRATION_DURATION });
            }
            res.status(200).json(formattedResponse);
        } else {
            return res.status(data.code).json(data);
        }
    } catch (error) {
        next(error);
    }
})

// Fetch Technical Analysis SMA - Alpha Vantage API
router.get('/getSMAData', checkCache((req) => `${req.query.interval}SMA: ${req.query.symbol}`), async (req, res, next) => {
    try {
        const queries = req.query;
        const RSIEndpoint = {
            method: 'GET',
            url: ALPHA_VANTAGE_API,
            params: {
                datatype: process.env.DEFAULT_API_RESP_FORMAT,
                time_period: queries.timePeriod,
                interval: (queries.interval).toLowerCase(),
                series_type: queries.seriesType,
                symbol: queries.symbol,
                function: 'SMA'
            },
            headers: {
                'x-rapidapi-key': process.env.RAPIDAPI_TECHNICAL_SMA_DATA_API_KEY,
                'x-rapidapi-host': process.env.API_HOST
            }
        };
        const resp = await axios.request(RSIEndpoint)
        const data = resp.data;

        if (resp.status === 200 && !data.Information) {
            const sma = data["Technical Analysis: SMA"];
            const values = Object.keys(sma).map(datetime => ({
                datetime: datetime,
                sma: sma[datetime]["SMA"],
            }));

            const formattedResponse = {
                "meta": data["Meta Data"],
                "values": values.slice(0, 150)
            }
            const redis = getRedisClient();
            if (redis) {
                await redis.set(`${queries.interval}SMA: ${queries.symbol}`, JSON.stringify(formattedResponse), { EX: process.env.DEFAULT_EXPIRATION_DURATION });
            }
            res.status(200).json(formattedResponse);
        } else {
            return res.status(500).json(data)
        }
    } catch (error) {
        next(error);
    }
})
module.exports = router;