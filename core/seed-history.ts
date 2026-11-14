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
  // the last Coo, before the rename to Buggie, one per language
  'cd96ca7ddfd732f100e1200857b21869af606bfee4b8d13d63f3d6de25a95ab6': 'coo',
  '77320e4b3e9e6b1173d5af7eabaa5b4fa12efa7f4190be680db069a9de170cc5': 'coo',
  '2dfea04e5d8c9e9c00604b79a929bd175a4c6f3ce68d9aae5966626105671768': 'coo',
  'a67fee13f84899d5a0d25de604acc007f95cdaf0d024d6120a2f6b6427242a99': 'coo',
  '91d4443cf093574851e93805c1ba541e7e2ac82d37ba7b4e0504ad4b65b7a5c7': 'coo',
  '364e61ac0d14792a2ea1618234567a2d1cb8d8fe4e8064e8ad1e22029ff758a7': 'coo',
  'f6fcdce04f530aabd8ac28b8f4e860eb9eb7ff4e900aceec954ce43486d909a9': 'coo',
  'ab02b7bd5cc662b0efbdea8adbb8745d782aa625d2de9e0a888a7de2b4ed806d': 'coo',
  'cae24fdca0f29d9ca566fbbe765de2d5b5259c49c28becf642331cb2cc5c1003': 'coo',
  '69df0004c01d7ea096bee92d66b3743c1f21366c14977ffdd63c162f65c0384e': 'coo',
  '7be4c0f33c17571121b570376c4f73d7166571cfd2f0297ea295e249277ccfca': 'coo',
  // the first Buggie, one per language
  '40675c6126d6747760e651f30f19f872e2d37998279e81d41a70c8da78cd5bfe': 'coo',
  '2c3761fd46e34a7de345041a8159764d5225beb2ca523fc9ccb2c5f14cbb0482': 'coo',
  '4caeabe8343eede0ddecfc33b071dfa710f3b3693ebc60869c467df929568ea8': 'coo',
  'bb3366ac612ba8f1f4216feb189faa74e1591325db2ce1ab985748370ff40d8e': 'coo',
  '77d9e72fda46c2d25c95bfb17e4e3a636fad590a4aaefae2045cf3a3e86c1c95': 'coo',
  '37bc7988de0536badcf85403a3b291c41abcdf9291e34a4c406501a2bd359963': 'coo',
  '2e138f13c5d5f49e712715dd2ff98dcbf89b2a3d1778e730325fbc4d79113263': 'coo',
  'db89dd57c2e231d0dce4897b41dc167eee4901e6a554ea3f77289b547dfc5963': 'coo',
  'fb30fa37c6086dd88b57cee5701c81577f4b6111defc4920922b37cc5fa576f1': 'coo',
  '07011b619efc70bcff0f0a37d9d5faa6941f262829e4f2b6d7d17948700a1e54': 'coo',
  '5e8932a81a891b0a242d753f98a949f54a5c1ac61f420eee89872df1f88ee99f': 'coo',
};
