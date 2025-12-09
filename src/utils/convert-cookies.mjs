// convert-cookies.mjs
import { readFile, writeFile } from "fs/promises";

async function cookiesTxtToAuthJson(cookiesTxtPath) {
  const lines = (await readFile(cookiesTxtPath, "utf8"))
    .split("\n")
    .filter((line) => !line.startsWith("#") && line.trim() !== "");

  const cookies = lines.map((line) => {
    const [domain, , path, secure, expires, name, value] = line.split("\t");
    return {
      name,
      value,
      domain: domain.startsWith(".") ? domain.slice(1) : domain,
      path,
      expires: parseInt(expires, 10) || -1,
      httpOnly: false,
      secure: secure === "TRUE",
    };
  });

  const auth = {
    cookies: cookies.filter((c) => c.domain.includes("google.com")),
    origins: [], // localStorage is hard to export; cookies are usually enough
  };

  await writeFile("./auth.json", JSON.stringify(auth, null, 2));
  console.log("✅ auth.json created from cookies.txt");
}

cookiesTxtToAuthJson("./cookies.txt");
