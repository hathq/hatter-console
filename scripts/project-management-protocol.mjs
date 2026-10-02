// Hatter downstream 2026: Console selects policy; Rust owns method existence.
import { CLIENT_RPC_METHODS } from '../server/lib/rpc-policy.mjs'
import { projectSchema } from '../bin/hatter-protocol-verify.mjs'
export function projectManagementClientSchema(canonical) {
  return projectSchema(canonical, CLIENT_RPC_METHODS)
}
