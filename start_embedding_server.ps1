$ErrorActionPreference = "Stop"

$LlamaDir = "D:\openpangu\llama.cpp-b8971"
$ModelPath = "D:\openpangu\models\bge-m3.Q4_K_M.gguf"
$LogDir = "D:\openpangu\logs"
$Port = 8089

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$env:PATH = @(
    $LlamaDir,
    "C:\Users\Administrator\AppData\Local\Programs\Python\Python312\Lib\site-packages\nvidia\cublas\bin",
    "C:\Users\Administrator\AppData\Local\Programs\Python\Python312\Lib\site-packages\nvidia\cuda_nvrtc\bin",
    "C:\Users\Administrator\AppData\Local\Programs\Python\Python312\Lib\site-packages\nvidia\cuda_runtime\bin",
    $env:PATH
) -join ";"

# Check if bge-m3 GGUF exists; if not, print instructions
if (-not (Test-Path $ModelPath)) {
    Write-Host "============================================================"
    Write-Host " bge-m3 model not found at: $ModelPath"
    Write-Host ""
    Write-Host " Download options:"
    Write-Host "  1. HuggingFace: https://huggingface.co/BAAI/bge-m3"
    Write-Host "  2. Convert to GGUF with llama.cpp convert_hf_to_gguf.py"
    Write-Host "  3. Or use sentence-transformers + FastAPI (see comments in this script)"
    Write-Host "============================================================"
    exit 1
}

try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/models" -TimeoutSec 2 | Out-Null
    Write-Host "bge-m3 embedding service already running: http://127.0.0.1:$Port/v1"
    exit 0
} catch {
    # Service not reachable; start new llama.cpp server.
}

$outLog = Join-Path $LogDir "bge_m3_8089.out.log"
$errLog = Join-Path $LogDir "bge_m3_8089.err.log"
$args = @(
    "-m", $ModelPath,
    "--host", "127.0.0.1",
    "--port", "$Port",
    "-c", "512",
    "-ngl", "24",
    "--embeddings",
    "--pooling", "cls",
    "--alias", "bge-m3"
)

$proc = Start-Process `
    -FilePath (Join-Path $LlamaDir "llama-server.exe") `
    -ArgumentList $args `
    -WorkingDirectory $LlamaDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru

Write-Host "bge-m3 embedding service starting on http://127.0.0.1:$Port/v1"
Write-Host "PID: $($proc.Id)"
Write-Host "Logs: $errLog"

<#
ALTERNATIVE: sentence-transformers + FastAPI (if GGUF conversion is not feasible)

pip install sentence-transformers fastapi uvicorn

# embedding_server.py
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import numpy as np

app = FastAPI()
model = SentenceTransformer("BAAI/bge-m3")

class EmbeddingRequest(BaseModel):
    model: str = "bge-m3"
    input: list[str]

class EmbeddingResponse(BaseModel):
    data: list[dict]

@app.post("/v1/embeddings")
def embeddings(req: EmbeddingRequest):
    vecs = model.encode(req.input, normalize_embeddings=True)
    return {"data": [{"embedding": v.tolist()} for v in vecs]}

# Run: uvicorn embedding_server:app --host 127.0.0.1 --port 8089
#>
