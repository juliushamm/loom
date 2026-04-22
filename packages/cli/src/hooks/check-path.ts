#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { checkPath } from './predicates.js'

const raw = readFileSync(0, 'utf8')
const input = raw ? JSON.parse(raw) : {}
const filePath: string = input?.tool_input?.file_path ?? ''
if (!filePath) process.exit(0)
const r = checkPath({ filePath })
if (!r.ok) {
  console.error(r.reason)
  process.exit(2)
}
process.exit(0)
