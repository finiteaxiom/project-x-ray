from .service import validate as check_token


def login(token):
    accepted = check_token(token)
    return accepted


def route_login(token):
    return login(token)
