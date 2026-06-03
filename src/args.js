"use strict";

function parseArgs(argv) {
  const args = { _: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("-")) {
      args._.push(token);
      continue;
    }

    if (token === "--") {
      args._.push(...argv.slice(i + 1));
      break;
    }

    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq !== -1) {
        args[token.slice(2, eq)] = token.slice(eq + 1);
        continue;
      }

      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
      continue;
    }

    if (token === "-j") {
      args.json = true;
    } else if (token === "-t" && argv[i + 1]) {
      args.text = argv[i + 1];
      i += 1;
    } else {
      args[token.slice(1)] = true;
    }
  }

  return args;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

module.exports = { parseArgs, readStdin };
