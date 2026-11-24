import hashlib
import hmac
import re
from dataclasses import dataclass

import phonenumbers

WORDS = dict(zip("zero one two three four five six seven eight nine".split(), "0123456789"))
WORDS.update(oh="0", o="0")
TOKEN = r"(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|oh|o)"
PHONE = re.compile(rf"(?<!\w)\+?{TOKEN}(?:[\s().,-]*{TOKEN})*(?!\w)", re.I)
YES = re.compile(r"^(?:yes(?:[, ]+(?:please|that(?:'s| is) (?:right|correct)|correct))?|correct|confirmed|that's right|that is correct)[.! ]*$", re.I)


def digits(text):
    text = re.sub(r"\b(double|triple)\s+(\w+)\b",
                  lambda m: " ".join([m[2]] * (2 if m[1].lower() == "double" else 3)), text, flags=re.I)
    return "".join(WORDS.get(part.lower(), part) for part in re.findall(r"\d+|\b[a-z]+\b", text, re.I)
                   if part.isdigit() or part.lower() in WORDS)


def expanded(text):
    return re.sub(r"\b(double|triple)\s+(\w+)\b",
                  lambda m: " ".join([m[2]] * (2 if m[1].lower() == "double" else 3)), text, flags=re.I)


def redact(text):
    return PHONE.sub(lambda m: "•••• " + digits(m[0])[-4:] if len(digits(m[0])) >= 7 else m[0], expanded(text))


@dataclass(frozen=True)
class CallerIdentity:
    key: str
    tail: str


class Confirmation:
    def __init__(self, secret):
        self.secret = secret
        self.candidate = None
        self.awaiting = False
        self.confirmed = None

    def candidate_from(self, text):
        for match in PHONE.finditer(expanded(text)):
            value = digits(match[0])
            if len(value) < 7:
                continue
            match_text = match[0].lstrip()
            try:
                country_prefix = "+" if match_text.startswith("+") or (len(value) == 12 and value.startswith("91")) else ""
                number = phonenumbers.parse(country_prefix + value, "IN")
                if phonenumbers.is_possible_number(number):
                    return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164)
            except phonenumbers.NumberParseException:
                pass
        return None

    def process(self, text, collecting=False):
        number = self.candidate_from(text)
        if number:
            self.candidate = number
            self.awaiting = False
            self.confirmed = None
            return "readback"
        if self.awaiting and self.candidate and YES.fullmatch(text.strip()):
            self.confirmed = CallerIdentity(
                hmac.new(self.secret, self.candidate.encode(), hashlib.sha256).hexdigest(), self.candidate[-4:],
            )
            self.candidate = None
            self.awaiting = False
            return "confirmed"
        if self.candidate:
            if re.match(r"^(?:no\b|wrong\b|incorrect\b|actually\b|correction\b|my (?:new )?(?:phone )?number\b)", text.strip(), re.I):
                self.candidate = None
                self.awaiting = False
                self.confirmed = None
                return "retry"
            return "repeat"
        if collecting:
            return "retry"
        return None

    def readback_finished(self):
        self.awaiting = self.candidate is not None
