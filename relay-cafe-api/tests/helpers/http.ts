import { app } from '../../src/app'

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

interface RequestOpts {
  method?: Method
  token?: string
  body?: Record<string, unknown>
  headers?: Record<string, string>
  ip?: string
}

/**
 * Make a request to the Hono app without starting a real HTTP server.
 * Uses Hono's `app.request()` which runs the full middleware stack.
 */
export async function request(path: string, opts: RequestOpts = {}) {
  const { method = 'GET', token, body, headers = {}, ip } = opts

  const init: RequestInit = { method, headers: { ...headers } }

  if (body) {
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  if (token) {
    ;(init.headers as Record<string, string>)['Authorization'] = `Bearer ${token}`
  }

  // Rate limiter reads X-Forwarded-For; randomize per-request by default
  // so tests don't accidentally rate-limit each other.
  if (ip) {
    ;(init.headers as Record<string, string>)['X-Forwarded-For'] = ip
  } else {
    ;(init.headers as Record<string, string>)['X-Forwarded-For'] = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`
  }

  const url = `http://localhost${path}`
  const res = await app.request(url, init)
  return res
}

/**
 * Shorthand: make a request and parse the JSON body.
 */
export async function requestJSON<T = unknown>(path: string, opts: RequestOpts = {}) {
  const res = await request(path, opts)
  const json = res.status !== 204 ? await res.json() as T : null
  return { status: res.status, json, res }
}

/**
 * Generate a unique IP to avoid rate limit collisions between tests.
 */
export function uniqueIP(): string {
  return `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
}
