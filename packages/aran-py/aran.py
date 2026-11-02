"""
Aran Python SDK.
Standard library only. Provides typed client for Aran Cloud Data-Flow Firewall.
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional


class AranError(Exception):
    """Base exception for all Aran SDK errors."""
    def __init__(self, message: str, status_code: Optional[int] = None, response_body: Optional[str] = None):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body


class AranAuthError(AranError):
    """Raised on 401 Unauthorized (missing or invalid API key)."""
    pass


class AranScopeError(AranError):
    """Raised on 403 Forbidden (API key lacks required scope)."""
    pass


class AranRateLimit(AranError):
    """Raised on 429 Too Many Requests (rate limit exceeded)."""
    def __init__(self, message: str, retry_after: Optional[int] = None, response_body: Optional[str] = None):
        super().__init__(message, status_code=429, response_body=response_body)
        self.retry_after = retry_after


class Aran:
    """Aran Cloud API Client."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "http://127.0.0.1:8100",
        timeout: float = 5.0,
        max_retries: int = 2,
        backoff_factor: float = 0.2,
    ):
        self.api_key = api_key.strip() if api_key else ""
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.backoff_factor = backoff_factor

    def _request(
        self,
        method: str,
        path: str,
        payload: Optional[Dict[str, Any]] = None,
        idempotent: bool = False,
    ) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        data = None
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "aran-python-sdk/1.0",
        }
        if self.api_key:
            headers["X-API-Key"] = self.api_key

        if payload is not None:
            data = json.dumps(payload).encode("utf-8")

        attempts = 1 + (self.max_retries if idempotent else 0)
        last_error = None

        for attempt in range(attempts):
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    resp_body = resp.read().decode("utf-8")
                    if resp_body:
                        try:
                            return json.loads(resp_body)
                        except json.JSONDecodeError:
                            return {"raw": resp_body}
                    return {}
            except urllib.error.HTTPError as e:
                code = e.code
                raw_body = e.read().decode("utf-8", errors="replace")
                err_detail = raw_body
                try:
                    parsed = json.loads(raw_body)
                    if isinstance(parsed, dict) and "detail" in parsed:
                        err_detail = parsed["detail"]
                except Exception:
                    pass

                # If 5xx on idempotent call, retry
                if idempotent and code >= 500 and attempt < attempts - 1:
                    time.sleep(self.backoff_factor * (2 ** attempt))
                    continue

                if code == 401:
                    raise AranAuthError(f"Authentication failed: {err_detail}", status_code=401, response_body=raw_body)
                elif code == 403:
                    raise AranScopeError(f"Forbidden: {err_detail}", status_code=403, response_body=raw_body)
                elif code == 429:
                    retry_after_hdr = e.headers.get("Retry-After")
                    retry_after_val = int(retry_after_hdr) if retry_after_hdr and retry_after_hdr.isdigit() else None
                    raise AranRateLimit(f"Rate limit exceeded: {err_detail}", retry_after=retry_after_val, response_body=raw_body)
                else:
                    raise AranError(f"HTTP {code}: {err_detail}", status_code=code, response_body=raw_body)

            except (urllib.error.URLError, TimeoutError) as e:
                last_error = e
                if idempotent and attempt < attempts - 1:
                    time.sleep(self.backoff_factor * (2 ** attempt))
                    continue
                raise AranError(f"Network error connecting to {url}: {e}")

        if last_error:
            raise AranError(f"Request to {url} failed after retries: {last_error}")

    def protect(
        self,
        text: str,
        customer_ref: Optional[str] = None,
        purpose: Optional[str] = None,
        sink: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Protects sensitive data by tokenizing detected PII."""
        payload: Dict[str, Any] = {"text": text}
        if customer_ref is not None:
            payload["customer_ref"] = customer_ref
        if purpose is not None:
            payload["purpose"] = purpose
        if sink is not None:
            payload["sink"] = sink
        return self._request("POST", "/v1/protect", payload=payload, idempotent=False)

    def gateway(self, prompt: str, role: str = "customer-care") -> Dict[str, Any]:
        """Scans and redacts prompts sent to LLMs / AI agents."""
        return self._request("POST", "/v1/gateway", payload={"prompt": prompt, "role": role}, idempotent=False)

    def trace(self, dump: str) -> Dict[str, Any]:
        """Traces leaked tokens in a database/log dump to identify origin sink."""
        return self._request("POST", "/v1/trace", payload={"dump": dump}, idempotent=True)

    def detokenise(self, token: str) -> Dict[str, Any]:
        """Resolves a vault token back to plaintext (authorized compliance view only)."""
        return self._request("POST", "/v1/detokenise", payload={"token": token}, idempotent=True)

    def erase(self, customer_ref: str, purpose: str = "KYC") -> Dict[str, Any]:
        """Executes DPDP Act Section 12 erasure for a customer and returns cryptographic receipt."""
        return self._request("POST", "/v1/erase", payload={"customer_ref": customer_ref, "purpose": purpose}, idempotent=False)

    def verify_receipt(self, receipt: Dict[str, Any]) -> Dict[str, Any]:
        """Cryptographically verifies a Merkle inclusion & signature on an erasure receipt."""
        return self._request("POST", "/v1/receipts/verify", payload=receipt, idempotent=True)

