"""Generated test identifiers and bank-style log lines with labelled spans.

Every identifier here is generated: Aadhaar numbers pass Verhoeff, card numbers pass
Luhn, but none belongs to a real person. Names are random first-name + surname
combinations from common-name lists, and addresses are random street, area and city
combinations, so no line describes a real individual.

Name parts, address parts, UPI handles and templates are split into disjoint TRAIN
and TEST halves, so test scores measure generalisation to unseen names and phrasings.
"""
import random

from aran_core import luhn_check_digit, verhoeff_check_digit

# ---------------------------------------------------------------- name and address parts
FIRST_EN = ["Ramesh", "Suresh", "Priya", "Anitha", "Rahul", "Kavitha", "Ajay", "Sunita", "Vijay", "Pooja",
            "Amit", "Neha", "Sanjay", "Deepak", "Manoj", "Rekha", "Aarthi", "Rajesh", "Geetha", "Mohan",
            "Karthik", "Divya", "Arjun", "Lakshmi", "Senthil", "Meena", "Vignesh", "Revathi", "Ganesh", "Swathi",
            "Harish", "Nandini", "Prakash", "Shalini", "Dinesh", "Bhavani", "Murugan", "Anjali", "Ravi", "Sowmya",
            "Imran", "Fathima", "Joseph", "Mary", "Gurpreet", "Harpreet", "Abdul", "Ayesha", "Tenzin", "Bindu"]
SURNAME_EN = ["Sharma", "Verma", "Kumar", "Singh", "Gupta", "Yadav", "Patel", "Mishra", "Joshi", "Chauhan",
              "Agarwal", "Tripathi", "Pandey", "Reddy", "Nair", "Iyer", "Pillai", "Menon", "Rao", "Naidu",
              "Krishnan", "Subramanian", "Raman", "Mukherjee", "Banerjee", "Das", "Bose", "Khan", "Sheikh", "Fernandes",
              "Dsouza", "Gill", "Sandhu", "Kulkarni", "Deshpande", "Patil", "Shetty", "Hegde", "Murthy", "Chettiar"]
FIRST_HI = ["रमेश", "सुरेश", "प्रिया", "अनीता", "राहुल", "कविता", "अजय", "सुनीता", "विजय", "पूजा",
            "अमित", "नेहा", "संजय", "दीपक", "मनोज", "रेखा", "आरती", "राजेश", "गीता", "मोहन"]
SURNAME_HI = ["शर्मा", "वर्मा", "कुमार", "सिंह", "गुप्ता", "यादव", "पटेल", "मिश्रा", "जोशी", "चौहान",
              "अग्रवाल", "त्रिपाठी", "पांडे", "रेड्डी", "नायर", "अय्यर"]
STREET_EN = ["MG Road", "Anna Salai", "Station Road", "Gandhi Nagar 2nd Street", "Nehru Street", "Temple Road",
             "Bazaar Street", "Park Avenue", "Church Road", "Lake View Road", "Netaji Subhash Marg", "Kamarajar Salai",
             "Ring Road", "Mill Road", "College Road", "Hospital Road"]
AREA_EN = ["Anna Nagar", "T Nagar", "Koramangala", "Indiranagar", "Andheri East", "Salt Lake", "Banjara Hills",
           "Vile Parle", "Gomti Nagar", "Civil Lines", "Adyar", "Velachery", "Whitefield", "Kothrud"]
CITY_EN = ["Madurai", "Chennai", "Bengaluru", "Mumbai", "Kolkata", "Hyderabad", "Lucknow", "Jaipur", "Pune",
           "Coimbatore", "Krishnankoil", "Virudhunagar", "Indore", "Bhopal", "Patna", "Kochi"]
STREET_HI = ["गांधी नगर", "स्टेशन रोड", "नेहरू मार्ग", "मंदिर गली", "बाज़ार रोड", "सिविल लाइंस", "राजपथ", "शास्त्री नगर"]
CITY_HI = ["जयपुर", "लखनऊ", "पटना", "भोपाल", "इंदौर", "दिल्ली", "कानपुर", "वाराणसी"]
UPI_HANDLES = ["okhdfcbank", "okicici", "oksbi", "okaxis", "ybl", "paytm", "ibl", "axl", "upi", "apl",
               "kotak", "icici", "sbi", "hdfcbank", "axisbank", "pnb", "barodampay", "unionbank", "indus", "fbl"]
SYS_USERS = ["root", "admin", "deploy", "oracle", "svc_batch", "jenkins", "postgres", "ubuntu", "git", "backup"]
SYS_HOSTS = ["cbs-prod-3", "db01", "app-node-12", "dr-site-2", "web7", "build-agent-04", "mq-broker-1", "ldap02",
             "batch-07", "vault-1"]
EMAIL_DOMAINS = ["gmail.com", "yahoo.co.in", "outlook.com", "rediffmail.com", "bank.example.in", "kare.ac.in"]


def _halves(xs):
    return xs[0::2], xs[1::2]


SPLITS = {}
for _name, _xs in [("first_en", FIRST_EN), ("surname_en", SURNAME_EN), ("first_hi", FIRST_HI),
                   ("surname_hi", SURNAME_HI), ("street_en", STREET_EN), ("area_en", AREA_EN),
                   ("city_en", CITY_EN), ("street_hi", STREET_HI), ("city_hi", CITY_HI),
                   ("upi", UPI_HANDLES), ("email", EMAIL_DOMAINS),
                   ("sys_user", SYS_USERS), ("sys_host", SYS_HOSTS)]:
    SPLITS[_name] = dict(zip(("train", "test"), _halves(_xs)))


# ---------------------------------------------------------------- generated identifiers
def digits(r, n):
    return "".join(r.choice("0123456789") for _ in range(n))


def gen_aadhaar(r):
    body = str(r.randint(2, 9)) + digits(r, 10)
    a = body + verhoeff_check_digit(body)
    return r.choice([a, f"{a[:4]} {a[4:8]} {a[8:]}", f"{a[:4]}-{a[4:8]}-{a[8:]}"])


def gen_card(r):
    body = r.choice(["4", "52", "60", "65", "81"]) + ""
    body += digits(r, 15 - len(body))
    c = body + luhn_check_digit(body)
    return r.choice([c, " ".join(c[i:i + 4] for i in range(0, 16, 4))])


def gen_mobile(r):
    m = str(r.randint(6, 9)) + digits(r, 9)
    return r.choice([m, "+91" + m, "+91 " + m, "+91-" + m])


def gen_pan(r):
    L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    return "".join(r.choice(L) for _ in range(3)) + r.choice("PCHFATBLJG") + r.choice(L) + digits(r, 4) + r.choice(L)


def gen_otp(r):
    return digits(r, r.choice([4, 6, 6, 6, 8]))


def gen_name(r, split, script="en"):
    s = SPLITS
    if script == "hi":
        return r.choice(s["first_hi"][split]) + " " + r.choice(s["surname_hi"][split])
    n = r.choice(s["first_en"][split]) + " " + r.choice(s["surname_en"][split])
    return n.upper() if r.random() < 0.15 else n


def gen_upi(r, split):
    s = SPLITS
    left = r.choice([r.choice(s["first_en"][split]).lower() + "." + r.choice(s["surname_en"][split]).lower(),
                     str(r.randint(6, 9)) + digits(r, 9),
                     r.choice(s["first_en"][split]).lower() + digits(r, r.randint(2, 4))])
    return left + "@" + r.choice(s["upi"][split])


def gen_email(r, split):
    s = SPLITS
    left = r.choice(s["first_en"][split]).lower() + r.choice([".", "_", ""]) + r.choice(s["surname_en"][split]).lower()
    return left + "@" + r.choice(s["email"][split])


def gen_userhost(r, split):
    s = SPLITS
    return r.choice(s["sys_user"][split]) + "@" + r.choice(s["sys_host"][split])


def gen_pin(r):
    return str(r.randint(1, 8)) + digits(r, 5)


def gen_address(r, split, script="en"):
    s = SPLITS
    if script == "hi":
        return (f"मकान नं. {r.randint(1, 250)}, {r.choice(s['street_hi'][split])}, "
                f"{r.choice(s['city_hi'][split])} {gen_pin(r)}")
    house = r.choice([str(r.randint(1, 400)), f"{r.randint(1, 90)}/{r.randint(1, 30)}", f"Flat {r.randint(101, 1204)}",
                      f"No. {r.randint(1, 300)}"])
    parts = [house, r.choice(s["street_en"][split])]
    if r.random() < 0.6:
        parts.append(r.choice(s["area_en"][split]))
    parts.append(r.choice(s["city_en"][split]) + r.choice([" ", " - ", "-"]) + gen_pin(r))
    return ", ".join(parts)


# ---------------------------------------------------------------- templates
# Slots in braces are filled and labelled. Labelled (sensitive) slot types:
#   PER, ADDR, OTP, UPI, AADHAAR, CARD, MOBILE, PAN
# Unlabelled (look-alike) slots: EMAIL, USERHOST, AMT, TXN, NUM, NUM4, NUM6, PORT
TEMPLATES = {
    "train": [
        ("en", "2026-03-04 10:12:55 INFO OtpService - OTP {OTP} generated for customer {PER} mobile {MOBILE}"),
        ("en", "[UPI] collect request from {UPI} to {UPI} amount INR {AMT} txn {TXN} status SUCCESS"),
        ("en", "DEBUG kyc.verify name=\"{PER}\" aadhaar={AADHAAR} result=MATCH"),
        ("en", "WARN AddressUpdate cust_id={NUM} new_address=\"{ADDR}\""),
        ("en", "card verification failed for card {CARD} holder {PER}"),
        ("en", "SMS gateway: Dear {PER}, {OTP} is your one time password for login. Do not share."),
        ("en", "login ok user={EMAIL} session={TXN} latency_ms={NUM}"),
        ("en", "payment of Rs.{AMT} to {UPI} debited from a/c XX{NUM4}"),
        ("en", "ERROR ivr call from {MOBILE} pin attempts=3 retry_after={NUM}s"),
        ("en", "beneficiary added: {PER}, {ADDR}, vpa {UPI}"),
        ("en", "PAN {PAN} linked to customer {PER}"),
        ("en", "Delivery address for card dispatch: {ADDR}"),
        ("en", "txn {TXN} amount {AMT} branch code {NUM4} port {PORT}"),
        ("en", "HTTP 200 GET /api/v2/accounts/{NUM}/balance {NUM} ms"),
        ("en", "order {NUM6} placed, will ship in {NUM} days"),
        ("en", "otp_send status=OK otp={OTP} channel=sms"),
        ("en", "reset password mail sent to {EMAIL} for {PER}"),
        ("en", "retrying job {NUM6} attempt {NUM} of 5 on port {PORT}"),
        ("en", "Received {AMT} from {PER} via UPI ID {UPI}"),
        ("en", "user {PER} entered wrong OTP {OTP}, attempts left {NUM}"),
        ("en", "error code {NUM4} returned by switch, rrn {TXN}"),
        ("en", "KYC address mismatch: provided '{ADDR}' for {PER}"),
        ("en", "Use {OTP} as your secure code for card ending {NUM4}"),
        ("en", "2FA token {OTP} validated for {PER}"),
        ("en", "http status code {NUM} for /upi/collect, took {NUM} ms"),
        ("en", "PIN reset: temporary pin {OTP} issued to {MOBILE}"),
        ("en", "sshd[{NUM}]: Accepted publickey for {USERHOST} port {PORT}"),
        ("en", "cron job finished on {USERHOST} in {NUM} ms"),
        ("hi", "ग्राहक {PER_HI} का ओटीपी {OTP} भेजा गया"),
        ("hi", "{PER_HI} ने {UPI} पर ₹{AMT} भेजे, लेनदेन {TXN}"),
        ("hi", "पता अपडेट: {ADDR_HI}"),
        ("hi", "खाता संख्या {NUM} की शेष राशि {AMT} रुपये"),
        ("hi", "{PER_HI} का पता {ADDR_HI} है"),
        ("hi", "आदेश {NUM6} दर्ज हुआ"),
        ("hi", "पासवर्ड {OTP} किसी को न बताएं"),
        ("hi", "{PER_HI} का मोबाइल {MOBILE} है"),
        ("hl", "customer {PER} ka otp {OTP} hai, kisi ko mat batana"),
        ("hl", "{PER} ne {UPI} pe {AMT} rupaye bheje"),
        ("hl", "bhai mera naya address {ADDR} hai"),
        ("hl", "aapka order {NUM6} kal tak deliver hoga"),
        ("hl", "{PER} ji ka mobile {MOBILE} band aa raha hai"),
        ("hl", "server {NUM} pe load {NUM} percent hai"),
        ("hl", "mera pin {OTP} hai, check karo"),
        ("hl", "error {NUM4} aa raha hai login pe"),
    ],
    "test": [
        ("en", "auth-svc | verification code {OTP} dispatched to {MOBILE} for {PER}"),
        ("en", "payee_vpa={UPI}; payer={PER}; amt={AMT}; rrn={TXN}"),
        ("en", "Customer {PER} residing at {ADDR} requested a cheque book"),
        ("en", "cache miss for key session:{NUM6} took {NUM} ms"),
        ("en", "Your login code is {OTP}. It expires in 10 minutes."),
        ("en", "notify {EMAIL}: statement for {PER} is ready"),
        ("en", "refund {TXN} credited to {UPI} after {NUM} retries"),
        ("en", "build {NUM6} deployed to node-{NUM}"),
        ("en", "aadhaar_no:{AADHAAR} pan:{PAN} applicant:{PER}"),
        ("en", "chargeback raised on {CARD} by {PER}, mobile {MOBILE}"),
        ("en", "mandate created vpa={UPI} limit={AMT}"),
        ("en", "OTP for txn {TXN} is {OTP}"),
        ("en", "mail relay accepted {EMAIL} size={NUM} bytes"),
        ("en", "courier pickup scheduled at {ADDR}"),
        ("en", "port {PORT} listening, pid {NUM}, uptime {NUM6}s"),
        ("en", "rsync from {USERHOST} completed, {NUM} files"),
        ("hi", "{PER_HI} जी, आपका सत्यापन कोड {OTP} है"),
        ("hi", "नया पता: {ADDR_HI}, ग्राहक {PER_HI}"),
        ("hi", "सर्वर {NUM} पर त्रुटि कोड {NUM4}"),
        ("hi", "भुगतान {UPI} को सफल, राशि {AMT}"),
        ("hl", "{PER} bhai ka upi id {UPI} hai"),
        ("hl", "otp aaya {OTP} , jaldi daalo"),
        ("hl", "ticket {NUM6} close kar diya"),
        ("hl", "{PER} madam ka ghar {ADDR} pe hai"),
        ("hl", "naya number {MOBILE} update karo"),
    ],
}

# TRAIN templates held out from model fitting and used only to fit the calibration,
# chosen so both parts cover every slot type and language.
CAL_TEMPLATES = {2, 4, 5, 9, 10, 11, 13, 18, 20, 23, 27, 30, 34, 35, 37, 38, 41}

LABELLED = {"PER", "PER_HI", "ADDR", "ADDR_HI", "OTP", "UPI", "AADHAAR", "CARD", "MOBILE", "PAN"}


def fill(r, slot, split):
    if slot == "PER": return gen_name(r, split)
    if slot == "PER_HI": return gen_name(r, split, "hi")
    if slot == "ADDR": return gen_address(r, split)
    if slot == "ADDR_HI": return gen_address(r, split, "hi")
    if slot == "OTP": return gen_otp(r)
    if slot == "UPI": return gen_upi(r, split)
    if slot == "EMAIL": return gen_email(r, split)
    if slot == "USERHOST": return gen_userhost(r, split)
    if slot == "AADHAAR": return gen_aadhaar(r)
    if slot == "CARD": return gen_card(r)
    if slot == "MOBILE": return gen_mobile(r)
    if slot == "PAN": return gen_pan(r)
    if slot == "AMT": return r.choice([str(r.randint(10, 99999)), f"{r.randint(10, 99999)}.{digits(r, 2)}"])
    if slot == "TXN": return r.choice(["TXN", "UTR", "", "rrn"]) + digits(r, r.choice([10, 12, 14]))
    if slot == "NUM": return str(r.randint(0, 99999))
    if slot == "NUM4": return digits(r, 4)
    if slot == "NUM6": return digits(r, 6)
    if slot == "PORT": return str(r.choice([443, 8080, 8443, 9092, 5432, 6379, 1521, r.randint(1024, 65535)]))
    raise KeyError(slot)


def make_line(r, lang, template, split):
    """Returns (text, spans) where spans are (start, end, type) for sensitive slots."""
    out, spans, i = [], [], 0
    pos = 0
    while i < len(template):
        j = template.find("{", i)
        if j < 0:
            out.append(template[i:]); break
        out.append(template[i:j]); pos += j - i
        k = template.index("}", j)
        slot = template[j + 1:k]
        val = fill(r, slot, split)
        if slot in LABELLED:
            spans.append((pos, pos + len(val), slot.replace("_HI", "")))
        out.append(val); pos += len(val)
        i = k + 1
    return "".join(out), spans


def make_corpus(split, n, seed=0, langs=("en", "hi", "hl"), part=None):
    """part='fit' or 'cal' uses only even or odd TRAIN templates, so the calibration set
    is made of phrasings the models did not train on, as at test time."""
    r = random.Random(seed)
    ts = TEMPLATES[split]
    if part is not None:
        ts = [t for i, t in enumerate(ts) if (i in CAL_TEMPLATES) == (part == "cal")]
    ts = [t for t in ts if t[0] in langs]
    rows = []
    for _ in range(n):
        lang, t = r.choice(ts)
        text, spans = make_line(r, lang, t, split)
        rows.append(dict(lang=lang, text=text, spans=spans))
    return rows


# ---------------------------------------------------------------- compositional training lines
# Hand-written templates are few, so a classifier can memorise them. For TRAIN only, lines
# are also composed from small phrase grammars. TEST stays the hand-written test templates.
G_OTP_EN = ["OTP", "one time password", "OTP code", "auth code", "security code", "login OTP", "txn OTP", "PIN",
            "passcode", "secret code", "2FA code", "temp password"]
G_NUM_EN = ["status code", "error code", "exit code", "http code", "port", "pid", "order no", "ticket", "build",
            "retries", "latency_ms", "amount", "branch code", "batch id", "queue depth", "record count", "invoice"]
G_CONN = [" is ", ": ", "=", " - ", " :", " "]
G_PRE = ["", "INFO sms-out ", "[notify] ", "DEBUG ", "audit: ", "2026-02-11T09:14:03Z "]
G_SUF = ["", ". Valid for 5 min", ". Do not share it with anyone", " for login", " (expires in 3 mins)", " sent", " ok"]
G_OTP_HI = ["ओटीपी", "पासवर्ड", "कोड", "पिन"]
G_NUM_HI = ["त्रुटि कोड", "आदेश संख्या", "टिकट", "राशि", "सर्वर"]
G_OTP_HL = ["otp", "code", "pin", "password"]
G_NUM_HL = ["order", "ticket", "error", "bill no", "token no"]


def _half(xs, part):
    return xs if part is None else xs[{"fit": 0, "cal": 1}[part]::2]


def grammar_line(r, split, part=None):
    lang = r.choice(["en", "en", "hi", "hl"])
    pos = r.random() < 0.5
    if lang == "en":
        if pos and r.random() < 0.3:
            head, val = r.choice(_half(G_PRE, part)) + "", gen_otp(r)
            text = f"{head}{val} is your {r.choice(_half(G_OTP_EN, part))}{r.choice(_half(G_SUF, part))}"
            a = len(head)
        else:
            w = r.choice(_half(G_OTP_EN, part) if pos else _half(G_NUM_EN, part))
            val = gen_otp(r) if pos else str(r.choice([r.randint(1000, 99999999), r.randint(100000, 999999)]))
            pre, per = r.choice(_half(G_PRE, part)), []
            if r.random() < 0.3 and pos:
                name = gen_name(r, split)
                per = [(len(pre) + len(w) + 5, len(pre) + len(w) + 5 + len(name), "PER")]
                w = w + " for " + name
            head = pre + w + r.choice(_half(G_CONN, part))
            text, a = head + val + r.choice(_half(G_SUF, part)), len(head)
            return dict(lang=lang, text=text, spans=per + ([(a, a + len(val), "OTP")] if pos else []))
    elif lang == "hi":
        w = r.choice(_half(G_OTP_HI, part) if pos else _half(G_NUM_HI, part))
        val = gen_otp(r) if pos else str(r.randint(1000, 999999))
        head = r.choice(["आपका ", "", "ग्राहक का "]) + w + r.choice([" ", ": "])
        text, a = head + val + r.choice([" है", "", " किसी को न बताएं", " दर्ज"]), len(head)
    else:
        w = r.choice(_half(G_OTP_HL, part) if pos else _half(G_NUM_HL, part))
        val = gen_otp(r) if pos else str(r.randint(1000, 999999))
        head = r.choice(["apna ", "mera ", "", "bhai "]) + w + r.choice([" ", " : "])
        text, a = head + val + r.choice([" hai", " kisi ko mat batao", " aaya", ""]), len(head)
    return dict(lang=lang, text=text, spans=[(a, a + len(val), "OTP")] if pos else [])


# Roadmap item 3: hard cases for the two measured weak spots, TRAIN phrasings only.
# OTPs next to transaction words ("OTP for ref 12345 is 482913") as positives, and the
# same shapes with no OTP word as negatives; bare mobiles after a verb or in a phone-named
# field as positives, and 10-digit reference numbers as negatives.
G_REF_EN = ["txn", "ref", "order", "invoice", "transfer", "payment", "booking", "request"]
G_OTP_TX = ["{o} for {w} {id} is {v}", "{w} {id}: {o} {v}", "{o} {v} to confirm {w} {id}", "use {o} {v} for {w} {id}",
            "{w} {id} needs {o} {v}", "{o} to approve {w} {id} = {v}"]
G_NEG_TX = ["{w} {id} is {v}", "{w} {id}: amount {v}", "{w} {id} retried {v} times", "{w} {id} value {v}",
            "{w} {id} queued at {v}", "{w} {id} batch {v}"]
G_MOB_POS = ["sms sent to {m}", "alert delivered to {m}", "callback from {m}", "linked {m} to account",
             "forwarded to {m} ok", '"mob":"{m}"', "ph={m}", '{{"contact": "{m}"}}', "msisdn={m} status=ACTIVE",
             "registered {m} for alerts", "{m} se call aaya", "{m} पर संदेश भेजा"]
G_MOB_NEG = ["ref no {r} posted", "acct {r} credited", "order id {r} shipped", "batch {r} done", "rrn={r} ok",
             '"txn_id":"{r}"', "job {r} finished", "invoice {r} raised"]


def hard_line(r, split, part=None):
    if r.random() < 0.5:
        pos = r.random() < 0.5
        tpl = r.choice(_half(G_OTP_TX if pos else G_NEG_TX, part))
        o = r.choice(_half(G_OTP_EN, part))
        w = r.choice(_half(G_REF_EN, part))
        ident = r.choice(["TXN", "REF", "", "#"]) + digits(r, r.choice([5, 8, 10]))
        v = gen_otp(r) if pos else str(r.randint(1000, 99999999))
        a = tpl.format(o=o, w=w, id=ident, v="\x00").index("\x00")
        text = tpl.format(o=o, w=w, id=ident, v=v)
        return dict(lang="en", text=text, spans=[(a, a + len(v), "OTP")] if pos else [])
    pos = r.random() < 0.5
    tpl = r.choice(_half(G_MOB_POS if pos else G_MOB_NEG, part))
    m = str(r.randint(6, 9)) + digits(r, 9)
    text = tpl.format(m=m, r=m)
    a = text.index(m)
    lang = "hi" if "पर" in tpl else ("hl" if "aaya" in tpl else "en")
    return dict(lang=lang, text=text, spans=[(a, a + 10, "MOBILE")] if pos else [])


def make_train_corpus(n, seed=0, grammar_frac=0.3, part=None, hard_frac=0.08):
    rows = make_corpus("train", int(n * (1 - grammar_frac - hard_frac)), seed, part=part)
    r = random.Random(seed + 1000)
    n_hard = int(n * hard_frac)
    rows += [grammar_line(r, "train", part) for _ in range(n - len(rows) - n_hard)]
    rows += [hard_line(r, "train", part) for _ in range(n_hard)]
    random.Random(seed).shuffle(rows)
    return rows
