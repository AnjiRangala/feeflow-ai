import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.request.use((request) => {
  const token = window.localStorage.getItem('feeflow.accessToken');
  if (token) request.headers.Authorization = `Bearer ${token}`;
  return request;
});

export function getApiError(error) {
  if (error.response?.data?.error) return error.response.data.error;
  if (error.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
  if (!error.response) return 'Unable to reach FeeFlow AI. Check that the API is running.';
  return 'Something went wrong. Please try again.';
}
