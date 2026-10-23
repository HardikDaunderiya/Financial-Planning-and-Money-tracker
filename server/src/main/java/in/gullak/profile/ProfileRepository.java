package in.gullak.profile;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface ProfileRepository extends JpaRepository<ProfileEntity, UUID> {}
