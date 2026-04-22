#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { checkBash } from './predicates.js'

const raw = readFileSync(0, 'utf8')
const input = raw ? JSON.parse(raw) : {}
const command: string = input?.tool_input?.command ?? ''
if (!command) process.exit(0)
const r = checkBash({ command })
if (!r.ok) {
  console.error(r.reason)
  process.exit(2)
}
process.exit(0)
