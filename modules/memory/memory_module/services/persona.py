import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from memory_module.db.models import Persona


def ensure_persona(session: Session, persona_id: uuid.UUID) -> Persona:
    external_id = str(persona_id)
    existing = session.scalar(select(Persona).where(Persona.external_id == external_id))
    if existing:
        return existing
    persona = Persona(id=persona_id, external_id=external_id)
    session.add(persona)
    session.flush()
    return persona
