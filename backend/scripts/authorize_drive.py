"""
Autorização OAuth2 de usuário para o Google Drive.

Execute UMA VEZ para gerar docs/drive_token.json:
    cd backend
    source .venv/bin/activate
    python scripts/authorize_drive.py

Pré-requisito: docs/oauth_client.json baixado do GCP Console
  (APIs & Services → Credentials → OAuth 2.0 Client ID → tipo Desktop app)
"""
import json
import os
import sys

SCOPES = ["https://www.googleapis.com/auth/drive"]
DOCS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "docs")
CLIENT_FILE = os.path.join(DOCS_DIR, "oauth_client.json")
TOKEN_FILE = os.path.join(DOCS_DIR, "drive_token.json")


def main():
    if not os.path.exists(CLIENT_FILE):
        print(f"ERRO: {CLIENT_FILE} não encontrado.")
        print()
        print("Passos para criar:")
        print("  1. Acesse: https://console.cloud.google.com/apis/credentials")
        print("  2. Projeto: weighty-skyline-499813-b5")
        print("  3. Criar credenciais → ID do cliente OAuth 2.0")
        print("  4. Tipo: App para computador (Desktop app)")
        print("  5. Baixe o JSON e salve como: docs/oauth_client.json")
        sys.exit(1)

    from google_auth_oauthlib.flow import InstalledAppFlow

    print("Abrindo navegador para autorizar o Google Drive...")
    print("Faça login com a conta que tem a pasta GERENCIADOR.")
    flow = InstalledAppFlow.from_client_secrets_file(CLIENT_FILE, SCOPES)
    creds = flow.run_local_server(port=0)

    token_data = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes),
    }
    os.makedirs(DOCS_DIR, exist_ok=True)
    with open(TOKEN_FILE, "w") as f:
        json.dump(token_data, f, indent=2)

    print(f"\nOK: token salvo em {TOKEN_FILE}")
    print("Adicione ao .env:")
    print("  GOOGLE_OAUTH_TOKEN_FILE=./docs/drive_token.json")


if __name__ == "__main__":
    main()
