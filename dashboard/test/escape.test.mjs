// Panel agent metinlerini yalnız textContent ile basar; HTML'e yazan API'ler geri gelmesin.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const dir = new URL('../public/', import.meta.url)

test('public/ altında HTML enjekte eden API yok', () => {
  for (const f of readdirSync(dir).filter(f => /\.(js|html)$/.test(f))) {
    const src = readFileSync(new URL(f, dir), 'utf8')
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\bon[a-z]+\s*=\s*["']/, f)
  }
})
