const BASE = "https://wmjbbuplqvxjcqevggux.supabase.co";
const KEY = "sb_publishable__1vlXA5hx8JwQqBH__sOEg_OGzDLFlH";
export const RESET_URL = "https://tommyyy-glitch.github.io/Mydo/reset.html";
export function recoveryToken(hash) {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  return p.get("type") === "recovery" &&
    p.get("token_type") === "bearer" &&
    !p.has("error")
    ? p.get("access_token") || null
    : null;
}
export function passwordError(password, confirm) {
  if (password.length < 12)
    return "請使用至少 12 個字元。 / Use at least 12 characters.";
  if (password !== confirm) return "兩次密碼不一致。 / Passwords do not match.";
  return "";
}
async function api(
  path,
  { method = "GET", body, token, request = fetch } = {},
) {
  const response = await request(BASE + "/auth/v1/" + path, {
    method,
    headers: {
      apikey: KEY,
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const allowed = [
      "over_email_send_rate_limit",
      "email_address_not_authorized",
      "email_address_invalid",
      "same_password",
      "weak_password",
    ];
    throw Error(
      response.status === 429
        ? "rate"
        : allowed.includes(data.error_code || data.code)
          ? data.error_code || data.code
          : "request",
    );
  }
  return response.json();
}
export const sendRecovery = (email, request) =>
  api("recover?redirect_to=" + encodeURIComponent(RESET_URL), {
    method: "POST",
    body: { email: email.trim() },
    request,
  });
export async function updatePassword(token, password, confirm, request) {
  if (!token) throw Error("expired");
  const error = passwordError(password, confirm);
  if (error) throw Error(error);
  return api("user", { method: "PUT", body: { password }, token, request });
}
function message(error) {
  return (
    {
      rate: "請稍後再試；電郵服務暫時達到發送限制。 / Email limit reached. Please try later.",
      over_email_send_rate_limit:
        "電郵發送限制已達上限，請稍後再試。 / Email limit reached.",
      email_address_not_authorized:
        "目前的電郵服務不允許寄送至此地址。 / This address is not allowed by the email service.",
      email_address_invalid: "請檢查電郵地址。 / Check the email address.",
      same_password:
        "請選擇與舊密碼不同的新密碼。 / Choose a different password.",
      weak_password:
        "請使用更長、更難猜的新密碼。 / Choose a stronger password.",
      expired: "連結已失效，請重新寄送。 / Link expired. Request a new one.",
    }[error.message] ||
    "未能完成，請檢查網絡或重新寄送連結。 / Could not complete. Check your connection or request a new link."
  );
}
async function start() {
  let token = recoveryToken(location.hash);
  const hadFragment = !!location.hash;
  // Remove recovery credentials before rendering; keep them only in this page's memory.
  history.replaceState(null, "", location.pathname);
  const status = document.querySelector("#status"),
    error = document.querySelector("#error"),
    requestForm = document.querySelector("#request-form"),
    passwordForm = document.querySelector("#password-form");
  requestForm.onsubmit = async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    error.textContent = "";
    try {
      await sendRecovery(new FormData(requestForm).get("email"));
      status.textContent =
        "重設請求已接受。如帳戶存在且允許寄送，你會收到電郵；請查看收件匣及垃圾郵件。 / Request accepted. If the account exists and email delivery is allowed, check your inbox and spam folder.";
    } catch (e) {
      error.textContent = message(e);
    } finally {
      button.disabled = false;
    }
  };
  passwordForm.onsubmit = async (event) => {
    event.preventDefault();
    const data = new FormData(passwordForm),
      password = data.get("password"),
      confirm = data.get("confirm"),
      validation = passwordError(password, confirm);
    error.textContent = validation;
    if (validation) return;
    const button = event.submitter;
    button.disabled = true;
    try {
      await updatePassword(token, password, confirm);
      token = null;
      passwordForm.reset();
      passwordForm.hidden = true;
      status.textContent =
        "密碼已更新。請回到主畫面的 Mydo 登入；Myfin 如要求登入，也使用新密碼。 / Password updated. Return to Mydo on your Home Screen and sign in. Use the new password in Myfin too.";
    } catch (e) {
      error.textContent = message(e);
      passwordForm.reset();
      button.disabled = false;
    }
  };
  if (token) {
    try {
      await api("user", { token });
      status.textContent =
        "連結已驗證，請自行設定新密碼。 / Link verified. Choose your new password.";
      passwordForm.hidden = false;
      return;
    } catch {
      token = null;
    }
  }
  requestForm.hidden = false;
  status.textContent = hadFragment
    ? "連結無效或已過期，請重新寄送。 / Link invalid or expired. Request a new one."
    : "輸入帳戶電郵，我們會寄出重設連結。 / Enter your account email for a reset link.";
}
if (typeof document !== "undefined") start();
