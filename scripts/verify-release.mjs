import { verifyRelease } from '../bin/hatter-release-verify.mjs'

const manifest = await verifyRelease(process.argv[2])
process.stdout.write(`${manifest.payloadDigest}\n`)
