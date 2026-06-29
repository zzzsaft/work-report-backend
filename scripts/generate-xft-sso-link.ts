import { buildXftSsoLoginUrl } from "../src/modules/xft/sso.js";

const usage = `Usage:
  npm run xft:sso-link -- <wecomUserId> [--pageId <pageId>] [--todoid <todoId>]

Examples:
  npm run xft:sso-link -- zhangsan
  npm run xft:sso-link -- zhangsan --pageId salary
  npm run xft:sso-link -- zhangsan --todoid 123456
`;

const args = process.argv.slice(2);

const readOption = (name: string) => {
  const index = args.findIndex((arg) => arg === `--${name}`);
  if (index < 0) return null;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : null;
};

const userId = args.find((arg, index) => {
  if (arg.startsWith("--")) return false;
  const previous = args[index - 1];
  return previous !== "--pageId" && previous !== "--todoid" && previous !== "--todoId";
});

const wantsHelp = args.includes("--help") || args.includes("-h");

if (!userId || wantsHelp) {
  console.log(usage);
  process.exit(wantsHelp ? 0 : 1);
}

const url = buildXftSsoLoginUrl({
  userid: userId,
  pageId: readOption("pageId"),
  todoId: readOption("todoid") || readOption("todoId")
});

console.log(url);
