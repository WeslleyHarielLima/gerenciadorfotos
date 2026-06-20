from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0007_task_perceptual_hash"),
    ]

    operations = [
        migrations.AddField(
            model_name="media",
            name="cloudinary_url",
            field=models.URLField(blank=True, max_length=1000),
        ),
        migrations.AddField(
            model_name="media",
            name="cloudinary_public_id",
            field=models.CharField(blank=True, max_length=300),
        ),
    ]
