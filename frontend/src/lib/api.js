import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

export const CURRENCY_SYMBOL = { USD: "$", EUR: "€", GBP: "£" };

export const fmtMoney = (amount, currency = "USD") =>
  `${CURRENCY_SYMBOL[currency] || ""}${Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}${CURRENCY_SYMBOL[currency] ? "" : " " + currency}`;
