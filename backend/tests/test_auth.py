"""Testes de autenticação JWT, refresh e controle de acesso por papel."""
import json

import pytest

from api.auth import create_access_token, create_refresh_token, verify_token

pytestmark = pytest.mark.django_db

LOGIN_URL = "/api/auth/login"
ME_URL = "/api/auth/me"
REFRESH_URL = "/api/auth/refresh"


def _login(client, username, password):
    return client.post(
        LOGIN_URL,
        data=json.dumps({"username": username, "password": password}),
        content_type="application/json",
    )


def test_login_sucesso_retorna_tokens_e_papel(client, editor):
    resp = _login(client, "editor_user", "pass12345")
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"] and body["refresh_token"]
    assert body["user"]["role"] == "editor"


def test_login_senha_errada_401(client, editor):
    assert _login(client, "editor_user", "errada").status_code == 401


def test_login_conta_inativa_401(client, make_user):
    make_user("editor", username="inativo", is_active=False)
    assert _login(client, "inativo", "pass12345").status_code == 401


def test_me_com_token_valido(client, curator, auth):
    resp = client.get(ME_URL, **auth(curator))
    assert resp.status_code == 200
    assert resp.json()["role"] == "curator"


def test_me_sem_token_401(client):
    assert client.get(ME_URL).status_code == 401


def test_refresh_emite_novo_access(client, publisher):
    refresh = create_refresh_token(publisher)
    resp = client.post(
        REFRESH_URL,
        data=json.dumps({"refresh_token": refresh}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    assert resp.json()["access_token"]


def test_refresh_rejeita_access_token(client, publisher):
    # passar um access token onde se espera refresh deve falhar
    access = create_access_token(publisher)
    resp = client.post(
        REFRESH_URL,
        data=json.dumps({"refresh_token": access}),
        content_type="application/json",
    )
    assert resp.status_code == 401


def test_verify_token_tipo_incorreto_retorna_none(publisher):
    access = create_access_token(publisher)
    assert verify_token(access, expected_type="refresh") is None
    assert verify_token(access, expected_type="access") is not None


def test_token_invalido_negado(client):
    resp = client.get(ME_URL, HTTP_AUTHORIZATION="Bearer lixo.invalido.xyz")
    assert resp.status_code == 401


def test_papel_errado_recebe_403(client, uploader, event, auth):
    # uploader tentando acessar o board do editor
    resp = client.get(f"/api/tasks/editor/board/{event.id}", **auth(uploader))
    assert resp.status_code == 403
