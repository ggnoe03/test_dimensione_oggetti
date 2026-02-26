from flask import Flask, render_template, request, jsonify
from measure import measure_image
import os

app = Flask(__name__)
app.secret_key = os.urandom(24)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/measure", methods=["POST"])
def measure():
    data = request.get_json()
    image_b64 = data.get("image")
    height_cm = data.get("height_cm", 159.0)
    h_fov_deg = data.get("h_fov_deg", 70.0)

    if not image_b64:
        return jsonify({"error": "Immagine mancante."}), 400

    try:
        height_cm = float(height_cm)
        h_fov_deg = float(h_fov_deg)
        if height_cm <= 0 or h_fov_deg <= 0:
            raise ValueError("I valori devono essere maggiori di zero.")
        result = measure_image(image_b64, height_cm, h_fov_deg)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 422


if __name__ == "__main__":
    app.run(debug=True)
