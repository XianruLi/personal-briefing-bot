/**
 * 天气：Open-Meteo（免费、无需 API Key、专为程序调用设计）。
 * 返回当前实况 + 未来几天的预报，供早报和复盘使用。
 */
import { config } from '../config.mjs';
import { fetchText } from '../util.mjs';

/** WMO 天气代码 → 中文描述 + 图标。 */
const WMO = {
  0: ['晴', '☀️'],
  1: ['晴间多云', '🌤'],
  2: ['多云', '⛅'],
  3: ['阴', '☁️'],
  45: ['有雾', '🌫'],
  48: ['雾凇', '🌫'],
  51: ['毛毛雨', '🌦'],
  53: ['毛毛雨', '🌦'],
  55: ['较密毛毛雨', '🌦'],
  56: ['冻毛毛雨', '🌧'],
  57: ['冻毛毛雨', '🌧'],
  61: ['小雨', '🌧'],
  63: ['中雨', '🌧'],
  65: ['大雨', '🌧'],
  66: ['冻雨', '🌧'],
  67: ['冻雨', '🌧'],
  71: ['小雪', '🌨'],
  73: ['中雪', '🌨'],
  75: ['大雪', '🌨'],
  77: ['雪粒', '🌨'],
  80: ['阵雨', '🌦'],
  81: ['阵雨', '🌧'],
  82: ['强阵雨', '⛈'],
  85: ['阵雪', '🌨'],
  86: ['强阵雪', '🌨'],
  95: ['雷阵雨', '⛈'],
  96: ['雷阵雨伴冰雹', '⛈'],
  99: ['强雷暴伴冰雹', '⛈'],
};

export function describeCode(code) {
  const hit = WMO[code];
  return hit ? { text: hit[0], emoji: hit[1] } : { text: '未知', emoji: '🌡' };
}

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 取日期字符串对应的星期（按预报里的日期算，不依赖本机时区）。 */
function weekdayOf(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return WEEKDAY_CN[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
}

/**
 * 抓取天气。
 * @returns {{ location, timezone, current, days, errors }}
 */
export async function collectWeather() {
  const cfg = config.sources.weather || {};
  const errors = [];
  const empty = { location: cfg.name || '', timezone: config.timeZone, current: null, days: [], errors };

  if (cfg.enabled === false) return empty;
  if (typeof cfg.latitude !== 'number' || typeof cfg.longitude !== 'number') {
    errors.push('天气：config/sources.json 里没配置 latitude / longitude');
    return { ...empty, errors };
  }

  const days = Math.min(Math.max(Number(cfg.forecastDays) || 2, 1), 7);
  const params = new URLSearchParams({
    latitude: String(cfg.latitude),
    longitude: String(cfg.longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,uv_index_max,sunrise,sunset',
    timezone: cfg.timezone || config.timeZone,
    forecast_days: String(days),
  });

  try {
    const raw = await fetchText('https://api.open-meteo.com/v1/forecast?' + params.toString(), {
      timeoutMs: 20000,
      label: '天气',
    });
    const w = JSON.parse(raw);
    const cur = w.current || {};
    const d = w.daily || {};

    const current = {
      temp: cur.temperature_2m,
      feelsLike: cur.apparent_temperature,
      humidity: cur.relative_humidity_2m,
      wind: cur.wind_speed_10m,
      ...describeCode(cur.weather_code),
    };

    const forecast = (d.time || []).map((date, i) => {
      const desc = describeCode(d.weather_code[i]);
      return {
        date,
        weekday: weekdayOf(date),
        min: d.temperature_2m_min[i],
        max: d.temperature_2m_max[i],
        rainChance: d.precipitation_probability_max[i],
        rainMm: d.precipitation_sum[i],
        windMax: d.wind_speed_10m_max[i],
        uvMax: d.uv_index_max[i],
        sunrise: (d.sunrise[i] || '').split('T')[1] || '',
        sunset: (d.sunset[i] || '').split('T')[1] || '',
        text: desc.text,
        emoji: desc.emoji,
      };
    });

    return { location: cfg.name || '', postcode: cfg.postcode || '', timezone: w.timezone, current, days: forecast, errors };
  } catch (err) {
    errors.push('天气：' + err.message);
    return { ...empty, errors };
  }
}

/** 给 AI 看的天气文本。 */
export function weatherToPromptText(weather, todayIso) {
  if (!weather || (!weather.current && !weather.days.length)) return '（天气数据没抓到）';
  const lines = [];
  if (weather.current) {
    const c = weather.current;
    lines.push('实况：' + c.temp + '°C（体感 ' + c.feelsLike + '°C），' + c.text + '，湿度 ' + c.humidity + '%，风速 ' + c.wind + ' km/h');
  }
  for (const day of weather.days) {
    const tag = day.date === todayIso ? '今天' : day.weekday;
    lines.push(
      tag + '（' + day.date + '）：' + day.min + '~' + day.max + '°C，' + day.text +
      '，降水概率 ' + (day.rainChance == null ? '?' : day.rainChance + '%') +
      '，预计雨量 ' + (day.rainMm == null ? '?' : day.rainMm + 'mm') +
      '，最大风速 ' + (day.windMax == null ? '?' : day.windMax + ' km/h') +
      '，UV ' + (day.uvMax == null ? '?' : day.uvMax) +
      '，日出 ' + day.sunrise + ' 日落 ' + day.sunset
    );
  }
  return lines.join('\n');
}
