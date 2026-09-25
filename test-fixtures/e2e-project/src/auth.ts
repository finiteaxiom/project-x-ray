import { validate } from "./validation";

export function login(token: string): boolean {
  return validate(token);
}

app.post("/login", login);
