const childProcess = require("node:child_process");

function parseCopilotOutput(output) {
  const events = output.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  const result = events.findLast((event) => event.type === "result");
  if (!result || result.exitCode !== 0) {
    throw new Error("Copilot did not complete successfully. Check CLI authentication and usage limits.");
  }
  const message = events.findLast((event) =>
    event.type === "assistant.message" &&
    typeof event.data?.content === "string" &&
    !event.data.toolRequests?.length
  );
  if (!message?.data.content.trim()) {
    throw new Error("Copilot returned no newsletter content.");
  }
  return message.data.content;
}

function callCopilot(messages, model) {
  const executable = process.env.COPILOT_CLI_PATH ||
    (process.platform === "win32" ? "copilot.exe" : "copilot");
  const args = [
    "--silent", "--output-format", "json", "--no-custom-instructions",
    "--disable-builtin-mcps", "--available-tools=", "--no-ask-user",
  ];
  if (model) args.push("--model", model);
  const prompt = messages.map(({ role, content }) => `## ${role.toUpperCase()}\n\n${content}`).join("\n\n");
  const env = { ...process.env };
  // Collection credentials must not override local Copilot login.
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
  delete env.OPENAI_API_KEY;

  return new Promise((resolve, reject) => {
    const child = childProcess.execFile(executable, args, {
      env,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        reject(new Error(`Copilot CLI failed (${error.code || "timeout"}). Run copilot login, check usage limits, and retry.`, { cause: error }));
        return;
      }
      try {
        resolve(parseCopilotOutput(stdout));
      } catch (error) {
        reject(error);
      }
    });
    // Piped input avoids command-line size limits and shell interpolation.
    child.stdin.on("error", (error) => reject(new Error("Could not send the draft to Copilot CLI.", { cause: error })));
    child.stdin.end(prompt);
  });
}

module.exports = { callCopilot, parseCopilotOutput };
