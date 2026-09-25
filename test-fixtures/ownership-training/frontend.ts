import { submitLogin } from "./transport";

export function handleLogin(token: string) {
  return submitLogin(token);
}
