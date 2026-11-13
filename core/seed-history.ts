/**
 * SHA-256 (LF line endings) of every self-description an earlier version shipped, by persona. A workspace
 * self-description still exactly as one of them is treated as unedited (`personaOf` in seed.ts), so the
 * next start replaces it with the current text of that persona.
 */
import type { PersonaId } from './seed.ts';

export const EARLIER_PERSONAS: Readonly<Record<string, PersonaId>> = {
  // what 0.1.0 (after the rename) and 0.1.1 seeded
  'cfcb7527cbf3518ab9f077ee711c86661a70613b9e5caeb992b30a603490e5cf': 'coo',
  // 0.2.0 to 0.2.4
  '4dfe941dd882df0ffd0446c21af87747b8001cfe64811c2970b2c03fed10fb64': 'coo',
  'cc5b43f0f3261aff6d6c3c345ee6b76f109e4d46eb72e35d4abb756acc53ec83': 'coo',
  'f7e377f3217a673d529b4d189f85e3ba57af4438dbf39d88bf2d319c90f42f7d': 'coo',
  '4dbba08b9c9bd8f159c49f3ab09e4a2460c84c8f0337888fc62fea74a480d9ac': 'coo',
  '0bd55f54e6c76edf2fa45dbf12db7a334ed08e0089fba46190956a118267ed36': 'coo',
  'e55c9731288e375f867d77832f0b7d27ebb89dbd3c97c54d6e3d8574a9a8640a': 'coo',
  '98d842313ae6aeb3fc25947fbfdbb0f2aaea0c17bd42322ad66883cd14bb6db6': 'coo',
  'ce097b69f1de41eb28afacf33fc44eb1e751a9ae79faa9f31354146b46c6f800': 'coo',
  '75a4ae4d638a1ccd7bd478e09209a705d4cc7dfac0898a497f44cb26d904c492': 'coo',
  '7e1cef7651d03934aa0ce5e3729d8236ba32d42da49a3baf873514c837388701': 'coo',
  '4c218dae889d4e8aada8d0939e5e7988bf91939c5fc1d8a5f0c55bb865a24068': 'coo',
  // 0.2.5 to 0.2.8, Japanese, before each persona got its own first person
  '78d4921d62d4b721184cb512b7bb6e6042364d7475e8945ca402ce1dce7874de': 'coo',
};
