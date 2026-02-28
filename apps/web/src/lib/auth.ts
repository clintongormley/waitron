"use client";

import { api, setToken, clearToken } from "./api";

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantId: string;
}

export async function login(email: string, password: string): Promise<User> {
  const res = await api.post<{ accessToken: string }>("/auth/login", {
    email,
    password,
  });
  setToken(res.accessToken);
  return api.get<User>("/auth/me");
}

export async function register(
  email: string,
  password: string,
  name: string,
  tenantName: string,
): Promise<User> {
  const res = await api.post<{ accessToken: string }>("/auth/register", {
    email,
    password,
    name,
    tenantName,
  });
  setToken(res.accessToken);
  return api.get<User>("/auth/me");
}

export function logout() {
  clearToken();
  window.location.href = "/login";
}
