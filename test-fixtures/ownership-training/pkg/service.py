def normalize(token):
    cleaned = token.strip()
    return cleaned


def validate(token):
    return len(normalize(token)) > 2
