package in.gullak.auth;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface UserRepository extends JpaRepository<UserEntity, UUID> {

    @Query("select u.id from UserEntity u where u.email = :email")
    Optional<UUID> findIdByEmail(@Param("email") String email);

    /** Native upsert: two first sign-ins for the same email at once still create one row. */
    @Modifying
    @Query(value = "insert into users (id, email) values (:id, :email) on conflict (email) do nothing",
        nativeQuery = true)
    int insertIfAbsent(@Param("id") UUID id, @Param("email") String email);
}
