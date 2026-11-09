import time
from io import BytesIO

import pytest
from PIL import Image

from app import main as main_module
from app import verify as verify_module
from app.verify import (
    FaceServiceError,
    ImageTooLarge,
    ImageValidationError,
    NoFaceDetected,
    UnsupportedImageType,
    _extract_gender,
    decode_selfie,
    decide,
)


def _image_bytes(image_format="PNG", size=(64, 64), color=(120, 80, 200)):
    buffer = BytesIO()
    Image.new("RGB", size, color).save(buffer, format=image_format)
    return buffer.getvalue()


def _analysis(woman=95.0, man=None, dominant=None):
    if man is None:
        man = round(100.0 - woman, 4)
    if dominant is None:
        dominant = "Woman" if woman >= man else "Man"
    return {
        "gender": {"Woman": woman, "Man": man},
        "dominant_gender": dominant,
    }


@pytest.fixture
def female_face(monkeypatch):
    monkeypatch.setattr(
        verify_module, "analyze_gender", lambda _image: [_analysis(95.0)]
    )
    monkeypatch.setattr(
        verify_module, "compute_embedding", lambda _image: [0.1, 0.2, 0.3]
    )


def _post_selfie(client, data=None, content_type="image/png", filename="selfie.png"):
    payload = _image_bytes() if data is None else data
    return client.post(
        "/verify",
        files={"selfie": (filename, payload, content_type)},
    )


def test_auto_approves_confident_female_selfie(client, female_face):
    response = _post_selfie(client)

    assert response.status_code == 200
    assert response.json() == {
        "face_detected": True,
        "gender": "female",
        "confidence": 0.95,
        "decision": "auto_approved",
        "embedding": [0.1, 0.2, 0.3],
    }


@pytest.mark.parametrize(
    ("woman", "expected"),
    [
        (85.0, "auto_approved"),
        (84.99, "needs_review"),
    ],
)
def test_threshold_boundary(client, monkeypatch, woman, expected):
    monkeypatch.setattr(
        verify_module, "analyze_gender", lambda _image: [_analysis(woman)]
    )
    monkeypatch.setattr(verify_module, "compute_embedding", lambda _image: [1.0])

    response = _post_selfie(client)

    assert response.status_code == 200
    assert response.json()["decision"] == expected


def test_male_selfie_goes_to_review_with_embedding(client, monkeypatch):
    monkeypatch.setattr(
        verify_module,
        "analyze_gender",
        lambda _image: [_analysis(4.0, 96.0)],
    )
    monkeypatch.setattr(verify_module, "compute_embedding", lambda _image: [0.4])

    response = _post_selfie(client)

    assert response.status_code == 200
    body = response.json()
    assert body["gender"] == "male"
    assert body["confidence"] == 0.96
    assert body["decision"] == "needs_review"
    assert body["embedding"] == [0.4]


def test_missing_gender_scores_goes_to_review(client, monkeypatch):
    monkeypatch.setattr(
        verify_module,
        "analyze_gender",
        lambda _image: [{"gender": {}, "dominant_gender": ""}],
    )
    monkeypatch.setattr(verify_module, "compute_embedding", lambda _image: [0.5])

    response = _post_selfie(client)

    assert response.status_code == 200
    body = response.json()
    assert body["gender"] == "unknown"
    assert body["confidence"] == 0.0
    assert body["decision"] == "needs_review"


def test_no_face_returns_200_without_embedding(client, monkeypatch):
    embedding_calls = []
    monkeypatch.setattr(
        verify_module,
        "analyze_gender",
        lambda _image: (_ for _ in ()).throw(NoFaceDetected("No face")),
    )
    monkeypatch.setattr(
        verify_module,
        "compute_embedding",
        lambda image: embedding_calls.append(image) or [0.1],
    )

    response = _post_selfie(client)

    assert response.status_code == 200
    assert response.json() == {
        "face_detected": False,
        "gender": None,
        "confidence": 0.0,
        "decision": "no_face",
        "embedding": [],
    }
    assert embedding_calls == []


def test_multiple_faces_return_no_face(client, monkeypatch):
    embedding_calls = []
    monkeypatch.setattr(
        verify_module,
        "analyze_gender",
        lambda _image: [_analysis(95.0), _analysis(95.0)],
    )
    monkeypatch.setattr(
        verify_module,
        "compute_embedding",
        lambda image: embedding_calls.append(image) or [0.1],
    )

    response = _post_selfie(client)

    assert response.status_code == 200
    assert response.json()["decision"] == "no_face"
    assert response.json()["face_detected"] is False
    assert embedding_calls == []


def test_face_lost_during_embedding_returns_no_face(client, monkeypatch):
    monkeypatch.setattr(
        verify_module, "analyze_gender", lambda _image: [_analysis(95.0)]
    )
    monkeypatch.setattr(
        verify_module,
        "compute_embedding",
        lambda _image: (_ for _ in ()).throw(NoFaceDetected("No face")),
    )

    response = _post_selfie(client)

    assert response.status_code == 200
    assert response.json()["decision"] == "no_face"


def test_unsupported_media_type_is_rejected(client):
    response = _post_selfie(client, content_type="image/gif")

    assert response.status_code == 415
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == "UNSUPPORTED_IMAGE_TYPE"


def test_oversized_upload_is_rejected(client):
    payload = b"\x00" * (main_module.settings.max_upload_bytes + 1)

    response = _post_selfie(client, data=payload)

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "IMAGE_TOO_LARGE"


def test_empty_upload_is_rejected(client):
    response = _post_selfie(client, data=b"")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_IMAGE"


def test_invalid_image_bytes_are_rejected(client):
    response = _post_selfie(client, data=b"definitely-not-an-image")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_IMAGE"


def test_runtime_failure_returns_502(client, monkeypatch):
    monkeypatch.setattr(
        verify_module, "analyze_gender", lambda _image: [_analysis(95.0)]
    )
    monkeypatch.setattr(
        verify_module,
        "compute_embedding",
        lambda _image: (_ for _ in ()).throw(FaceServiceError("model down")),
    )

    response = _post_selfie(client)

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "VERIFICATION_FAILED"


def test_timeout_returns_504(client, monkeypatch):
    def slow_verify(_data, _mime):
        time.sleep(0.2)
        return {
            "face_detected": True,
            "gender": "female",
            "confidence": 0.99,
            "decision": "auto_approved",
            "embedding": [],
        }

    monkeypatch.setattr(verify_module, "verify_selfie", slow_verify)
    monkeypatch.setattr(main_module.settings, "verify_timeout_seconds", 0.02)

    response = _post_selfie(client)

    assert response.status_code == 504
    assert response.json()["error"]["code"] == "VERIFICATION_TIMEOUT"


def test_upload_parser_keeps_max_sized_selfie_in_memory():
    assert main_module.MultiPartParser.max_file_size == main_module.settings.max_upload_bytes


def test_verification_metric_is_incremented(client, female_face):
    _post_selfie(client)

    response = client.get("/metrics")

    assert "shedrive_face_verifications_total" in response.text


def test_decode_accepts_jpeg_and_png():
    png = decode_selfie(_image_bytes("PNG"), "image/png")
    jpeg = decode_selfie(_image_bytes("JPEG"), "image/jpeg")

    assert png.shape == (64, 64, 3)
    assert jpeg.shape == (64, 64, 3)


def test_decode_rejects_unsupported_mime():
    with pytest.raises(UnsupportedImageType):
        decode_selfie(_image_bytes("PNG"), "image/gif")


def test_decode_rejects_format_mismatch():
    with pytest.raises(UnsupportedImageType):
        decode_selfie(_image_bytes("GIF"), "image/png")


def test_decode_rejects_invalid_bytes():
    with pytest.raises(ImageValidationError):
        decode_selfie(b"not-an-image", "image/png")


def test_decode_rejects_pixel_bomb(monkeypatch):
    monkeypatch.setattr(verify_module.settings, "max_image_pixels", 100)

    with pytest.raises(ImageTooLarge):
        decode_selfie(_image_bytes("PNG", size=(20, 20)), "image/png")


def test_extract_gender_handles_percentages_and_fractions():
    assert _extract_gender(_analysis(95.0)) == ("female", 0.95)
    assert _extract_gender(_analysis(0.95, 0.05)) == ("female", 0.95)
    assert _extract_gender({"gender": {}, "dominant_gender": "Man"}) == ("male", 0.0)


def test_decide_threshold():
    assert decide("female", 0.85, 0.85) == "auto_approved"
    assert decide("female", 0.8499, 0.85) == "needs_review"
    assert decide("male", 1.0, 0.85) == "needs_review"
    assert decide("unknown", 1.0, 0.85) == "needs_review"
